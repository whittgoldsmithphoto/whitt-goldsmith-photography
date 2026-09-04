import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import Stripe from "stripe";
import type { Sql } from "../db.ts";
import { createCommerce } from "./service.ts";
import { applyVerifiedSessionOutcome, type VerifiedSessionOutcome } from "./session-outcomes.ts";
import {
  acceptSandboxWebhook,
  type SandboxOrder,
  type SandboxProvider,
  type SandboxCommerce,
} from "./stripe-adapter.ts";

async function fixture(includeMigration = true) {
  const db = new PGlite();
  for (const name of [
    "0005_catalog.sql",
    "0006_photo_management.sql",
    "0008_commerce.sql",
    ...(includeMigration ? ["0011_commerce_session_outcomes.sql"] : []),
  ])
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const sql = Object.assign(
    async () => {
      throw new Error("query only");
    },
    {
      query: async <T>(query: string, params: unknown[] = []) =>
        (await db.query<T>(query, params)).rows,
    },
  ) as Sql;
  const commerce = createCommerce(sql, async () => 1);
  await db.exec(`INSERT INTO catalog_galleries(id,title,published,visibility) VALUES('gallery','Fixture',true,'public');
    INSERT INTO catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key,status) VALUES('photo','gallery','owner','fixture.jpg','image/jpeg',4,'hash','private/test.jpg','ready');`);
  await commerce.configurePriceList({ id: "default", name: "Default", isDefault: true });
  await commerce.configureProduct({
    id: "digital",
    name: "Digital",
    license: "Personal",
    active: true,
  });
  await commerce.configurePrice({ priceListId: "default", productId: "digital", unitCents: 2500 });
  await commerce.configureCoupon({
    code: "LAST",
    percentOff: 10,
    maxUses: 1,
    minimumCents: 0,
    galleryId: null,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    active: true,
  });
  const quote = () =>
    commerce.quote("customer", {
      galleryId: "gallery",
      items: [{ productId: "digital", photoId: "photo", quantity: 1 }],
      couponCode: "LAST",
    });
  async function pending() {
    const q = await quote();
    const o = await commerce.orderForQuote("customer", q.id);
    await commerce.bindProviderSession(o.id, `cs_test_${o.id}`);
    return {
      q,
      o,
      event: {
        eventId: `evt_${o.id}`,
        orderId: o.id,
        kind: "expired",
        sessionId: `cs_test_${o.id}`,
        paymentId: null,
        amountCents: q.total_cents,
        currency: "usd",
      } as VerifiedSessionOutcome,
    };
  }
  return { db, sql, commerce, quote, pending };
}

test("signed null-intent expiration and async failure release coupon reservations once", async () => {
  const f = await fixture();
  try {
    const signing = new Stripe("sk_test_fixture_only");
    const secret = "whsec_fixture_only";
    const lookup = (column: string, value: string) =>
      f.sql
        .query<SandboxOrder>(
          `SELECT o.*,q.total_cents,q.currency FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id WHERE ${column}=$1`,
          [value],
        )
        .then((rows) => rows[0]);
    const domain: SandboxCommerce = {
      orderBySession: (id) => lookup("o.provider_session_id", id),
      orderByPayment: (id) => lookup("o.provider_payment_id", id),
      apply: (e) => f.commerce.applyVerifiedPayment(e),
      applySessionOutcome: (e) => applyVerifiedSessionOutcome(f.sql, e),
    };
    for (const kind of ["expired", "async_failed"] as const) {
      const { q, o, event } = await f.pending();
      await assert.rejects(f.quote(), /exhausted/);
      const session = {
        id: event.sessionId,
        object: "checkout.session",
        livemode: false,
        mode: "payment",
        status: kind === "expired" ? "expired" : "complete",
        payment_status: "unpaid",
        payment_intent: kind === "expired" ? null : "pi_failed",
        client_reference_id: o.id,
        metadata: { wgp_order_id: o.id, wgp_quote_id: q.id, wgp_environment: "staging" },
        amount_total: q.total_cents,
        currency: "usd",
      } as unknown as Stripe.Checkout.Session;
      const provider: SandboxProvider = {
        accountId: async () => "acct_fixture",
        session: async () => session,
        charge: async () => {
          throw new Error("not called");
        },
        paymentIntent: async () =>
          ({
            id: "pi_failed",
            object: "payment_intent",
            livemode: false,
            status: "requires_payment_method",
            amount: q.total_cents,
            amount_received: 0,
            currency: "usd",
          }) as Stripe.PaymentIntent,
      };
      const raw = JSON.stringify({
        id: event.eventId,
        object: "event",
        livemode: false,
        type:
          kind === "expired" ? "checkout.session.expired" : "checkout.session.async_payment_failed",
        data: { object: session },
      });
      const signature = signing.webhooks.generateTestHeaderString({ payload: raw, secret });
      const config = {
        webhookSecret: secret,
        expectedAccountId: "acct_fixture",
        expectedLivemode: false,
        environment: "staging",
      } as const;
      assert.equal(
        (await acceptSandboxWebhook(raw, signature, config, provider, domain)).applied,
        "failed",
      );
      assert.equal(
        (await acceptSandboxWebhook(raw, signature, config, provider, domain)).applied,
        "failed",
      );
      assert.equal((await f.commerce.customerOrder("customer", o.id)).status, "failed");
      assert.equal(
        (await f.db.query(`SELECT * FROM commerce_session_events WHERE order_id=$1`, [o.id])).rows
          .length,
        1,
      );
      const stored = (
        await f.db.query<{ payment_id: string | null }>(
          `SELECT payment_id FROM commerce_session_events WHERE order_id=$1`,
          [o.id],
        )
      ).rows[0];
      assert.equal(stored.payment_id, kind === "expired" ? null : "pi_failed");
      await assert.rejects(
        f.commerce.applyVerifiedPayment({
          ...event,
          kind: "paid",
          paymentId: "pi_late",
          eventId: "evt_late",
        }),
        /Invalid payment transition/,
      );
    }
    assert.equal((await f.quote()).total_cents, 2250);
    assert.equal(
      (await f.db.query<{ consumed: number }>(`SELECT consumed FROM commerce_coupons`)).rows[0]
        .consumed,
      0,
    );
    assert.equal((await f.db.query(`SELECT * FROM commerce_entitlements`)).rows.length, 0);
  } finally {
    await f.db.close();
  }
});

test("session ledger rejects mismatched/replayed events and cannot downgrade paid or refunded orders", async () => {
  const f = await fixture();
  try {
    const { o, event } = await f.pending();
    await assert.rejects(
      applyVerifiedSessionOutcome(f.sql, { ...event, sessionId: "wrong" }),
      /does not match/,
    );
    await assert.rejects(
      applyVerifiedSessionOutcome(f.sql, { ...event, amountCents: 1 }),
      /does not match/,
    );
    const paid = { ...event, eventId: "evt_paid", kind: "paid" as const, paymentId: "pi_paid" };
    await f.commerce.applyVerifiedPayment(paid);
    const failure = { ...event, paymentId: "pi_paid" };
    assert.equal((await applyVerifiedSessionOutcome(f.sql, failure)).status, "paid");
    assert.equal((await applyVerifiedSessionOutcome(f.sql, failure)).status, "paid");
    await assert.rejects(
      applyVerifiedSessionOutcome(f.sql, { ...failure, kind: "async_failed" }),
      /Conflicting event replay/,
    );
    await assert.rejects(
      applyVerifiedSessionOutcome(f.sql, { ...failure, eventId: "evt_paid" }),
      /Conflicting event replay/,
    );
    await f.commerce.applyVerifiedPayment({ ...paid, eventId: "evt_refund", kind: "refunded" });
    assert.equal(
      (await applyVerifiedSessionOutcome(f.sql, { ...failure, eventId: "evt_after_refund" }))
        .status,
      "refunded",
    );
    assert.equal((await f.commerce.customerOrder("customer", o.id)).status, "refunded");
    assert.equal(
      (await f.db.query<{ consumed: number }>(`SELECT consumed FROM commerce_coupons`)).rows[0]
        .consumed,
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("missing0011 migration fails closed without changing order state", async () => {
  const f = await fixture(false);
  try {
    const { o, event } = await f.pending();
    await assert.rejects(applyVerifiedSessionOutcome(f.sql, event), /does not exist/);
    assert.equal((await f.commerce.customerOrder("customer", o.id)).status, "pending");
    await assert.rejects(f.quote(), /exhausted/);
  } finally {
    await f.db.close();
  }
});
