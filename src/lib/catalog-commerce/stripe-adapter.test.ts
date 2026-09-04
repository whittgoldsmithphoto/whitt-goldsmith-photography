import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Sql } from "../db.ts";
import { createCommerce, type VerifiedPayment } from "./service.ts";
import { applyVerifiedSessionOutcome, type VerifiedSessionOutcome } from "./session-outcomes.ts";
import {
  acceptSandboxWebhook,
  type SandboxOrder,
  type SandboxProvider,
  type SandboxCommerce,
  type SandboxWebhookConfig,
} from "./stripe-adapter.ts";
import { createSandboxWebhookHandler, sandboxWebhookConfiguration } from "./stripe-webhook-http.ts";

const secret = "whsec_generated_local_test_fixture_only";
const stripe = new Stripe("sk_test_local_signature_fixture_only");
const config: SandboxWebhookConfig = {
  webhookSecret: secret,
  expectedAccountId: "acct_fixture",
  expectedLivemode: false,
  environment: "staging",
};
function envelope(
  object: unknown,
  type = "checkout.session.completed",
  patch: Record<string, unknown> = {},
) {
  const raw = JSON.stringify({
    id: "evt_fixture",
    object: "event",
    livemode: false,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
    ...patch,
  });
  return { raw, signature: stripe.webhooks.generateTestHeaderString({ payload: raw, secret }) };
}
function fixture() {
  let calls = 0;
  const applied: VerifiedPayment[] = [];
  const outcomes: VerifiedSessionOutcome[] = [];
  const order: SandboxOrder = {
    id: "order",
    quote_id: "quote",
    provider_session_id: "cs_test_fixture",
    provider_payment_id: null,
    total_cents: 2500,
    currency: "usd",
  };
  const session = {
    id: "cs_test_fixture",
    object: "checkout.session",
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: "pi_fixture",
    client_reference_id: "order",
    metadata: { wgp_order_id: "order", wgp_quote_id: "quote", wgp_environment: "staging" },
    amount_total: 2500,
    currency: "usd",
  } as unknown as Stripe.Checkout.Session;
  const charge = {
    id: "ch_fixture",
    object: "charge",
    livemode: false,
    paid: true,
    refunded: true,
    amount: 2500,
    amount_refunded: 2500,
    currency: "usd",
    payment_intent: "pi_fixture",
  } as Stripe.Charge;
  const paidCharge = {
    ...charge,
    refunded: false,
    amount_refunded: 0,
    captured: true,
    amount_captured: 2500,
    disputed: false,
  };
  const intent = {
    id: "pi_fixture",
    object: "payment_intent",
    livemode: false,
    status: "succeeded",
    amount: 2500,
    amount_received: 2500,
    currency: "usd",
    latest_charge: paidCharge,
  } as unknown as Stripe.PaymentIntent;
  const provider: SandboxProvider = {
    accountId: async () => {
      calls++;
      return "acct_fixture";
    },
    session: async () => {
      calls++;
      return session;
    },
    paymentIntent: async () => {
      calls++;
      return intent;
    },
    charge: async () => {
      calls++;
      return charge;
    },
  };
  const commerce: SandboxCommerce = {
    orderBySession: async () => order,
    orderByPayment: async () => order,
    apply: async (p) => {
      applied.push(p);
    },
    applySessionOutcome: async (event) => {
      outcomes.push(event);
      return { status: "failed" };
    },
  };
  const send = (
    type = "checkout.session.completed",
    object: unknown = session,
    patch: Record<string, unknown> = {},
  ) => {
    const event = envelope(object, type, patch);
    return acceptSandboxWebhook(event.raw, event.signature, config, provider, commerce);
  };
  return {
    session,
    charge,
    paidCharge,
    intent,
    order,
    provider,
    commerce,
    applied,
    outcomes,
    send,
    calls: () => calls,
  };
}

test("delayed paid events cannot grant after a refund, partial refund, dispute or incomplete capture", async () => {
  for (const patch of [
    { refunded: true },
    { amount_refunded: 1 },
    { disputed: true },
    { captured: false },
    { amount_captured: 2000 },
    { payment_intent: "pi_wrong" },
  ]) {
    const f = fixture();
    Object.assign(f.paidCharge, patch);
    await assert.rejects(f.send(), /Latest charge/);
    assert.equal(f.applied.length, 0);
  }
  for (const patch of [
    { amount_received: 2000 },
    { currency: "eur" },
    { status: "processing" },
    { livemode: true },
  ]) {
    const f = fixture();
    Object.assign(f.intent, patch);
    await assert.rejects(f.send(), /PaymentIntent/);
    assert.equal(f.applied.length, 0);
  }
});

test("real Stripe HMAC verifies before provider or database access; tampering and stale signatures fail", async () => {
  const f = fixture();
  const event = envelope(f.session);
  await assert.rejects(
    acceptSandboxWebhook(event.raw + " ", event.signature, config, f.provider, f.commerce),
    /Invalid webhook signature/,
  );
  const expired = stripe.webhooks.generateTestHeaderString({
    payload: event.raw,
    secret,
    timestamp: Math.floor(Date.now() / 1000) - 1000,
  });
  await assert.rejects(
    acceptSandboxWebhook(event.raw, expired, config, f.provider, f.commerce),
    /Invalid webhook signature/,
  );
  const future = stripe.webhooks.generateTestHeaderString({
    payload: event.raw,
    secret,
    timestamp: Math.floor(Date.now() / 1000) + 1000,
  });
  await assert.rejects(
    acceptSandboxWebhook(event.raw, future, config, f.provider, f.commerce),
    /signature timestamp/,
  );
  await assert.rejects(
    acceptSandboxWebhook(event.raw, "", config, f.provider, f.commerce),
    /Invalid webhook signature/,
  );
  assert.equal(f.calls(), 0);
  assert.equal(f.applied.length, 0);
  assert.equal((await f.send()).applied, "paid");
  assert.equal(f.applied.length, 1);
});
test("live, Connect, organization and wrong-account events fail closed", async () => {
  const f = fixture();
  await assert.rejects(f.send(undefined, undefined, { livemode: true }), /Live-mode/);
  await assert.rejects(
    f.send(undefined, undefined, { account: "acct_other" }),
    /Connected-account/,
  );
  await assert.rejects(f.send(undefined, undefined, { context: "org_context" }), /organization/);
  f.provider.accountId = async () => "acct_wrong";
  await assert.rejects(f.send(), /account does not match/);
  assert.equal(f.applied.length, 0);
});
test("provider readback controls amount, currency, metadata, customer reference, mode and payment", async () => {
  for (const patch of [
    { amount_total: 1 },
    { currency: "eur" },
    { livemode: true },
    { mode: "subscription" },
    { status: "open" },
    { payment_intent: null },
    { client_reference_id: "other" },
    { metadata: { wgp_order_id: "order", wgp_quote_id: "wrong", wgp_environment: "staging" } },
    { metadata: { wgp_order_id: "order", wgp_quote_id: "quote", wgp_environment: "production" } },
  ]) {
    const f = fixture();
    const signed = { ...f.session };
    Object.assign(f.session, patch);
    await assert.rejects(f.send("checkout.session.completed", signed));
    assert.equal(f.applied.length, 0);
  }
});
test("unpaid completion remains pending; only paid asynchronous success grants", async () => {
  const f = fixture();
  f.session.payment_status = "unpaid";
  f.session.payment_intent = null;
  assert.equal((await f.send()).applied, "none");
  assert.equal(f.applied.length, 0);
  await assert.rejects(f.send("checkout.session.async_payment_succeeded"));
  f.session.payment_status = "paid";
  f.session.payment_intent = "pi_fixture";
  assert.equal((await f.send("checkout.session.async_payment_succeeded")).applied, "paid");
});
test("full refunds require bound payment, retrieved full amount, account and session", async () => {
  const f = fixture();
  await assert.rejects(f.send("charge.refunded", f.charge), /paid local order/);
  f.order.provider_payment_id = "pi_fixture";
  f.charge.amount_refunded = 100;
  await assert.rejects(f.send("charge.refunded", f.charge), /full refunds/);
  f.charge.amount_refunded = 2500;
  assert.equal((await f.send("charge.refunded", f.charge)).applied, "refunded");
  assert.equal(f.applied[0].kind, "refunded");
});
test("unsupported dispute and partial-refund event types are explicit, not silently acknowledged", async () => {
  const f = fixture();
  for (const type of ["charge.dispute.created", "refund.updated"])
    await assert.rejects(f.send(type), /not implemented/);
  assert.equal(f.calls(), 0);
  assert.equal(f.applied.length, 0);
});
test("signed expired sessions accept null payment IDs; async failures require verified unpaid intent", async () => {
  const f = fixture();
  f.session.status = "expired";
  f.session.payment_status = "unpaid";
  f.session.payment_intent = null;
  assert.equal((await f.send("checkout.session.expired")).applied, "failed");
  assert.equal(f.outcomes[0].paymentId, null);
  assert.equal(f.applied.length, 0);
  f.session.status = "complete";
  await assert.rejects(
    f.send("checkout.session.async_payment_failed"),
    /no verifiable PaymentIntent/,
  );
  f.session.payment_intent = "pi_fixture";
  f.intent.status = "processing";
  f.intent.amount_received = 0;
  await assert.rejects(f.send("checkout.session.async_payment_failed"), /terminal failure/);
  f.intent.status = "requires_payment_method";
  assert.equal((await f.send("checkout.session.async_payment_failed")).applied, "failed");
  assert.equal(f.outcomes[1].paymentId, "pi_fixture");
  f.session.payment_status = "paid";
  await assert.rejects(f.send("checkout.session.async_payment_failed"), /confirmed unpaid/);
});

test("signed webhook with provider outage or unknown local order cannot fulfill", async () => {
  const f = fixture();
  f.commerce.orderBySession = async () => undefined;
  await assert.rejects(f.send(), /no bound local order/);
  f.provider.session = async () => {
    throw new Error("Provider temporarily unavailable");
  };
  await assert.rejects(f.send(), /temporarily unavailable/);
  assert.equal(f.applied.length, 0);
});
test("sandbox HTTP defaults closed and rejects live/old settings, malformed and oversized payloads", async () => {
  const f = fixture();
  const disabled = createSandboxWebhookHandler(undefined, f.provider, f.commerce);
  assert.equal(
    (
      await disabled(
        new Request("https://example.test/api/commerce-webhook", { method: "POST", body: "{}" }),
      )
    ).status,
    503,
  );
  const settings: Record<string, string> = {
    CATALOG_ENV: "staging",
    CATALOG_STRIPE_WEBHOOK_ENABLED: "true",
    CATALOG_STRIPE_SECRET_KEY: "sk_test_fixture",
    CATALOG_STRIPE_WEBHOOK_SECRET: secret,
    CATALOG_STRIPE_ACCOUNT_ID: "acct_fixture",
  };
  assert.ok(sandboxWebhookConfiguration((name) => settings[name] || ""));
  assert.equal(
    sandboxWebhookConfiguration((name) =>
      name === "CATALOG_ENV" ? "production" : settings[name] || "",
    ),
    undefined,
  );
  assert.equal(
    sandboxWebhookConfiguration((name) =>
      name === "CATALOG_STRIPE_SECRET_KEY" ? "sk_live_forbidden" : settings[name] || "",
    ),
    undefined,
  );
  assert.equal(
    sandboxWebhookConfiguration((name) => (name.startsWith("STRIPE_") ? "legacy_secret" : "")),
    undefined,
  );
  const handler = createSandboxWebhookHandler(config, f.provider, f.commerce);
  assert.equal(
    (
      await handler(
        new Request("https://example.test/api/commerce-webhook", { method: "POST", body: "{}" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handler(
        new Request("https://example.test/api/commerce-webhook", {
          method: "POST",
          headers: { "stripe-signature": "x" },
          body: "x".repeat(262145),
        }),
      )
    ).status,
    413,
  );
  const event = envelope(f.session);
  const response = await handler(
    new Request("https://example.test/api/commerce-webhook", {
      method: "POST",
      headers: { "stripe-signature": event.signature },
      body: event.raw,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).applied, "paid");
});
test("signed paid replay and signed full refund exercise the real database state machine", async () => {
  const db = new PGlite();
  try {
    for (const name of [
      "0005_catalog.sql",
      "0006_photo_management.sql",
      "0008_commerce.sql",
      "0011_commerce_session_outcomes.sql",
    ])
      await db.exec(
        await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"),
      );
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
    await commerce.configurePrice({
      priceListId: "default",
      productId: "digital",
      unitCents: 2500,
    });
    const q = await commerce.quote("customer", {
      galleryId: "gallery",
      items: [{ productId: "digital", photoId: "photo", quantity: 1 }],
    });
    const o = await commerce.orderForQuote("customer", q.id);
    await commerce.bindProviderSession(o.id, "cs_test_fixture");
    const f = fixture();
    f.session.client_reference_id = o.id;
    f.session.metadata = { wgp_order_id: o.id, wgp_quote_id: q.id, wgp_environment: "staging" };
    const lookup = (where: string, value: string) =>
      sql
        .query<SandboxOrder>(
          `SELECT o.*,q.total_cents,q.currency FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id WHERE ${where}=$1`,
          [value],
        )
        .then((rows) => rows[0]);
    const domain: SandboxCommerce = {
      orderBySession: (id) => lookup("o.provider_session_id", id),
      orderByPayment: (id) => lookup("o.provider_payment_id", id),
      apply: (e) => commerce.applyVerifiedPayment(e),
      applySessionOutcome: (e) => applyVerifiedSessionOutcome(sql, e),
    };
    const event = envelope(f.session);
    f.paidCharge.refunded = true;
    f.paidCharge.amount_refunded = 2500;
    await assert.rejects(
      acceptSandboxWebhook(event.raw, event.signature, config, f.provider, domain),
      /Latest charge/,
    );
    assert.equal((await db.query(`SELECT * FROM commerce_entitlements`)).rows.length, 0);
    assert.equal((await commerce.customerOrder("customer", o.id)).status, "pending");
    f.paidCharge.refunded = false;
    f.paidCharge.amount_refunded = 0;
    await acceptSandboxWebhook(event.raw, event.signature, config, f.provider, domain);
    await acceptSandboxWebhook(event.raw, event.signature, config, f.provider, domain);
    assert.equal((await db.query(`SELECT * FROM commerce_entitlements`)).rows.length, 1);
    const refund = envelope(f.charge, "charge.refunded", { id: "evt_refund" });
    await acceptSandboxWebhook(refund.raw, refund.signature, config, f.provider, domain);
    assert.equal((await commerce.customerOrder("customer", o.id)).status, "refunded");
    assert.ok(
      (await db.query<{ revoked_at: unknown }>(`SELECT revoked_at FROM commerce_entitlements`))
        .rows[0].revoked_at,
    );
  } finally {
    await db.close();
  }
});
