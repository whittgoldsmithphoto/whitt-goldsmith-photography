import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";
import type { Sql } from "../db.ts";
import { createCommerce, type Quote } from "./service.ts";
import {
  checkoutLines,
  createSandboxCheckout,
  type CheckoutConfiguration,
  type CheckoutProvider,
} from "./checkout.server.ts";

test("sandbox checkout uses immutable server amounts, one order/session, and current access", async () => {
  const db = new PGlite();
  try {
    for (const name of [
      "0005_catalog.sql",
      "0006_photo_management.sql",
      "0008_commerce.sql",
      "0017_checkout_attempts.sql",
    ])
      await db.exec(
        await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"),
      );
    const sql = Object.assign(
      async () => {
        throw new Error("Use query");
      },
      {
        query: async <T>(query: string, values: unknown[] = []) =>
          (await db.query<T>(query, values)).rows,
      },
    ) as Sql;
    await db.exec(`INSERT INTO catalog_galleries(id,title,visibility,published) VALUES('g','Football','public',true);
      INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status,width,height)
      VALUES('p','g','owner','game.jpg','image/jpeg',500,'hash','private/original.jpg','ready',6000,4000)`);
    let access = true;
    const authorize = async () => {
      if (!access) throw new Error("Access denied");
      return 1;
    };
    const commerce = createCommerce(sql, authorize);
    await commerce.configurePriceList({ id: "default", name: "Default", isDefault: true });
    await commerce.configureProduct({
      id: "digital",
      name: "Original",
      license: "Personal use",
      active: true,
    });
    await commerce.configurePrice({
      priceListId: "default",
      productId: "digital",
      unitCents: 2500,
    });
    const quote = await commerce.quote("customer", {
      galleryId: "g",
      items: [{ photoId: "p", productId: "digital", quantity: 1 }],
    });
    const config: CheckoutConfiguration = {
      environment: "staging",
      checkoutEnabled: true,
      deliveryAccepted: true,
      sandboxTaxFixtureAccepted: true,
      secretKey: "sk_test_fixture_only",
      accountId: "acct_fixture",
      origin: "https://staging.example.com",
    };
    let calls = 0;
    let transientCreateFailure = true;
    let expireCalls = 0;
    let stableKey: string | undefined;
    let stableParams: Stripe.Checkout.SessionCreateParams | undefined;
    let saved: Stripe.Checkout.Session | undefined;
    const provider: CheckoutProvider = {
      findSessions: async () => ({ sessions: [], complete: true }),
      accountId: async () => "acct_fixture",
      create: async (params, key) => {
        calls++;
        assert.equal(key, params.client_reference_id);
        if (stableKey) {
          assert.equal(key, stableKey);
          assert.deepEqual(params, stableParams);
        }
        stableKey = key;
        stableParams = params;
        assert.equal(params.line_items?.[0]?.price_data?.unit_amount, 2500);
        assert.equal(
          params.success_url,
          `https://staging.example.com/checkout/complete?orderId=${key}`,
        );
        assert.ok(params.expires_at! >= Math.floor(Date.now() / 1000) + 1800);
        assert.ok(params.expires_at! <= Math.floor(Date.now() / 1000) + 86400);
        saved = {
          id: "cs_test_fixture",
          object: "checkout.session",
          livemode: false,
          mode: "payment",
          status: "open",
          payment_status: "unpaid",
          client_reference_id: key,
          metadata: params.metadata,
          amount_total: 2500,
          currency: "usd",
          expires_at: params.expires_at,
          url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
        } as Stripe.Checkout.Session;
        if (transientCreateFailure) {
          transientCreateFailure = false;
          throw new Error("Provider create response lost");
        }
        return saved;
      },
      retrieve: async () => {
        return saved!;
      },
      expire: async () => {
        expireCalls++;
        saved!.status = "expired";
        return saved!;
      },
    };
    const checkout = createSandboxCheckout(sql, authorize, config, provider);
    await assert.rejects(checkout("customer", { quoteId: quote.id, total: 1 }));
    await assert.rejects(checkout("attacker", { quoteId: quote.id }));
    assert.equal(calls, 0);
    for (const invalid of [
      { environment: "production" },
      { checkoutEnabled: false },
      { deliveryAccepted: false },
      { sandboxTaxFixtureAccepted: false },
      { secretKey: "sk_live_fixture" },
      { origin: "https://example.com/path" },
      { accountId: "acct_wrong" },
    ])
      await assert.rejects(
        createSandboxCheckout(
          sql,
          authorize,
          { ...config, ...invalid },
          provider,
        )("customer", { quoteId: quote.id }),
      );
    assert.equal(calls, 0);
    await assert.rejects(
      checkout("customer", { quoteId: quote.id }),
      /Provider create response lost/,
    );
    // Retry across deployment configuration changes uses the originally frozen parameters.
    const first = await createSandboxCheckout(
      sql,
      authorize,
      { ...config, origin: "https://new-staging.example.com" },
      provider,
    )("customer", { quoteId: quote.id });
    assert.deepEqual(await checkout("customer", { quoteId: quote.id }), first);
    assert.equal(calls, 2);
    await assert.rejects(
      sql.query("UPDATE commerce_checkout_attempts SET params='{}'::jsonb"),
      /immutable/,
    );
    await db.exec("UPDATE commerce_quotes SET expires_at=now()-interval '1 minute'");
    assert.deepEqual(
      await checkout("customer", { quoteId: quote.id }),
      first,
      "Existing session remains retrievable after quote expiry under recorded attempt lifetime",
    );
    await assert.rejects(checkout.cancel("attacker", { quoteId: quote.id }), /unavailable/);
    assert.equal(expireCalls, 0);
    assert.equal(
      (await sql.query<{ count: number }>("SELECT count(*)::int AS count FROM commerce_orders"))[0]
        .count,
      1,
    );
    saved!.livemode = true;
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /does not match/);
    saved!.livemode = false;
    saved!.url = "https://checkout.stripe.com.evil.example/pay";
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /destination/);
    saved!.url = "https://checkout.stripe.com/c/pay/cs_test_fixture";
    access = false;
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /Access denied/);
    assert.equal(expireCalls, 1, "Losing access expires the already issued Stripe session");
    assert.equal(
      (await sql.query<{ state: string }>("SELECT state FROM commerce_checkout_attempts"))[0].state,
      "expired",
    );
    assert.deepEqual(await checkout.cancel("customer", { quoteId: quote.id }), {
      orderId: first.orderId,
      status: "expired",
    });
    access = true;
    await db.exec("UPDATE catalog_photos SET hidden=true WHERE id='p'");
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /no longer available/);
    await db.exec(
      "UPDATE catalog_photos SET hidden=false WHERE id='p'; UPDATE catalog_galleries SET access_version=2 WHERE id='g'",
    );
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /no longer available/);
    assert.equal(calls, 2);
    // A lost create response and failed expiration cannot accidentally reopen checkout.
    await db.exec("UPDATE catalog_galleries SET access_version=1 WHERE id='g'");
    const cancelQuote = await commerce.quote("customer", {
      galleryId: "g",
      items: [{ photoId: "p", productId: "digital", quantity: 1 }],
    });
    let recovered: Stripe.Checkout.Session | undefined;
    let loseCreate = true,
      failExpiry = true;
    let recoveryParams: Stripe.Checkout.SessionCreateParams | undefined;
    const recoveringProvider: CheckoutProvider = {
      findSessions: provider.findSessions,
      accountId: provider.accountId,
      create: async (params, key) => {
        if (recoveryParams) assert.deepEqual(params, recoveryParams);
        recoveryParams = params;
        recovered ??= {
          ...saved!,
          id: `cs_test_${key}`,
          status: "open",
          client_reference_id: key,
          metadata: params.metadata,
          expires_at: params.expires_at,
        } as Stripe.Checkout.Session;
        if (loseCreate) {
          loseCreate = false;
          throw new Error("Ambiguous creation");
        }
        return recovered;
      },
      retrieve: async () => recovered!,
      expire: async () => {
        if (failExpiry) {
          failExpiry = false;
          throw new Error("Expiration network failure");
        }
        recovered!.status = "expired";
        return recovered!;
      },
    };
    const recovering = createSandboxCheckout(sql, authorize, config, recoveringProvider);
    await assert.rejects(recovering("customer", { quoteId: cancelQuote.id }), /Ambiguous creation/);
    const disabled = createSandboxCheckout(
      sql,
      authorize,
      { ...config, checkoutEnabled: false, deliveryAccepted: false },
      recoveringProvider,
    );
    await assert.rejects(
      disabled.cancel("customer", { quoteId: cancelQuote.id }),
      /Expiration network failure/,
    );
    assert.equal(
      (
        await sql.query<{ state: string }>(
          "SELECT a.state FROM commerce_checkout_attempts a JOIN commerce_orders o ON o.id=a.order_id WHERE o.quote_id=$1",
          [cancelQuote.id],
        )
      )[0].state,
      "cancel_requested",
    );
    await assert.rejects(
      recovering("customer", { quoteId: cancelQuote.id }),
      /no longer available/,
    );
    assert.equal(recovered!.status, "expired");
    await assert.rejects(
      sql.query("UPDATE commerce_checkout_attempts SET state='reserved' WHERE state='expired'"),
      /immutable/,
    );
    const paidQuote = await commerce.quote("customer", {
      galleryId: "g",
      items: [{ photoId: "p", productId: "digital", quantity: 1 }],
    });
    let completed: Stripe.Checkout.Session;
    const alreadyPaidProvider: CheckoutProvider = {
      findSessions: provider.findSessions,
      accountId: provider.accountId,
      create: async (params, key) => {
        completed = {
          ...saved!,
          id: `cs_test_${key}`,
          status: "complete",
          payment_status: "paid",
          client_reference_id: key,
          metadata: params.metadata,
          expires_at: params.expires_at,
        } as Stripe.Checkout.Session;
        return completed;
      },
      retrieve: async () => completed,
      expire: async () => {
        throw new Error("Must never expire an already completed session");
      },
    };
    const paidCheckout = createSandboxCheckout(sql, authorize, config, alreadyPaidProvider);
    await assert.rejects(paidCheckout("customer", { quoteId: paidQuote.id }), /already completed/);
    await assert.rejects(
      paidCheckout.cancel("customer", { quoteId: paidQuote.id }),
      /refund reconciliation/,
    );
    assert.equal(
      (
        await sql.query<{ status: string }>(
          "SELECT status FROM commerce_orders WHERE quote_id=$1",
          [paidQuote.id],
        )
      )[0].status,
      "pending",
      "Only verified provider events/reconciliation may finalize payment status",
    );
    assert.equal(
      (
        await sql.query<{ state: string }>(
          "SELECT a.state FROM commerce_checkout_attempts a JOIN commerce_orders o ON o.id=a.order_id WHERE o.quote_id=$1",
          [paidQuote.id],
        )
      )[0].state,
      "complete",
    );

    const agedQuote = await commerce.quote("customer", {
      galleryId: "g",
      items: [{ photoId: "p", productId: "digital", quantity: 1 }],
    });
    let agedCreates = 0;
    let agedSession: Stripe.Checkout.Session;
    let lookup: { sessions: Stripe.Checkout.Session[]; complete: boolean } = {
      sessions: [],
      complete: true,
    };
    const aged = createSandboxCheckout(sql, authorize, config, {
      ...alreadyPaidProvider,
      create: async (params, key) => {
        agedCreates++;
        agedSession = {
          ...saved!,
          id: `cs_test_${key}`,
          status: "open",
          payment_status: "unpaid",
          client_reference_id: key,
          metadata: params.metadata,
          expires_at: params.expires_at,
        } as Stripe.Checkout.Session;
        throw new Error("Uncertain timeout");
      },
      findSessions: async (range) => {
        assert.equal(range.quoteId, agedQuote.id);
        assert.ok(range.createdBefore - range.createdAfter <= 3661);
        return lookup;
      },
      retrieve: async () => agedSession,
      expire: async () => {
        agedSession.status = "expired";
        return agedSession;
      },
    });
    await assert.rejects(aged("customer", { quoteId: agedQuote.id }), /Uncertain timeout/);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31 * 60 * 1000;
      await assert.rejects(
        aged.cancel("customer", { quoteId: agedQuote.id }),
        /creation window elapsed/,
      );
      lookup = { sessions: [agedSession!], complete: false };
      await assert.rejects(aged.cancel("customer", { quoteId: agedQuote.id }), /not definitive/);
      lookup = { sessions: [agedSession!, agedSession!], complete: true };
      await assert.rejects(aged.cancel("customer", { quoteId: agedQuote.id }), /not definitive/);
      lookup = { sessions: [{ ...agedSession!, amount_total: 1 }], complete: true };
      await assert.rejects(aged.cancel("customer", { quoteId: agedQuote.id }), /does not match/);
      assert.equal(
        agedSession!.status,
        "open",
        "No mutation based on ambiguous or mismatched lookup",
      );
      lookup = { sessions: [agedSession!], complete: true };
      const cancelled = await aged.cancel("customer", { quoteId: agedQuote.id });
      assert.equal(cancelled.status, "expired");
      assert.equal(
        agedSession!.status,
        "expired",
        "Bounded read-only lookup recovers and expires an old ambiguous session",
      );
      assert.equal(
        agedCreates,
        1,
        "Do not recreate an ambiguous session outside the safe Stripe creation window",
      );
    } finally {
      Date.now = realNow;
    }
  } finally {
    await db.close();
  }
});

test("snapshot discount allocation preserves exact cents for odd percentages", () => {
  const items = [101, 203, 307].map((amount, index) => ({
    productId: "digital",
    photoId: String(index),
    name: "Original",
    kind: "digital_photo" as const,
    license: "Personal",
    filename: "game.jpg",
    quantity: 1,
    unitCents: amount,
    lineCents: amount,
  }));
  for (let discount = 0; discount < 611; discount++) {
    const quote = {
      items,
      subtotal_cents: 611,
      discount_cents: discount,
      total_cents: 611 - discount,
      tax_cents: 0,
      shipping_cents: 0,
      currency: "usd",
    } as Quote;
    const lines = checkoutLines(quote);
    assert.equal(
      lines.reduce((sum, line) => sum + line.price_data!.unit_amount!, 0),
      quote.total_cents,
    );
    assert.ok(lines.every((line) => line.price_data!.unit_amount! >= 0));
  }
});
