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
    for (const name of ["0005_catalog.sql", "0006_photo_management.sql", "0008_commerce.sql"])
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
    let transientReadFailure = true;
    let stableKey: string | undefined;
    let stableParams: string | undefined;
    let saved: Stripe.Checkout.Session | undefined;
    const provider: CheckoutProvider = {
      accountId: async () => "acct_fixture",
      create: async (params, key) => {
        calls++;
        assert.equal(key, params.client_reference_id);
        if (stableKey) {
          assert.equal(key, stableKey);
          assert.equal(JSON.stringify(params), stableParams);
        }
        stableKey = key;
        stableParams = JSON.stringify(params);
        assert.equal(params.line_items?.[0]?.price_data?.unit_amount, 2500);
        assert.equal(params.success_url, "https://staging.example.com/checkout/complete");
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
          url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
        } as Stripe.Checkout.Session;
        return saved;
      },
      retrieve: async () => {
        if (transientReadFailure) {
          transientReadFailure = false;
          throw new Error("Provider read timeout");
        }
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
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /Provider read timeout/);
    const first = await checkout("customer", { quoteId: quote.id });
    assert.deepEqual(await checkout("customer", { quoteId: quote.id }), first);
    assert.equal(calls, 2);
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
    access = true;
    await db.exec("UPDATE catalog_photos SET hidden=true WHERE id='p'");
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /no longer available/);
    await db.exec(
      "UPDATE catalog_photos SET hidden=false WHERE id='p'; UPDATE catalog_galleries SET access_version=2 WHERE id='g'",
    );
    await assert.rejects(checkout("customer", { quoteId: quote.id }), /no longer available/);
    assert.equal(calls, 2);
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
