import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Sql } from "../db.ts";
import { createCommerce, type VerifiedPayment } from "./service.ts";
import { applyVerifiedSessionOutcome, type VerifiedSessionOutcome } from "./session-outcomes.ts";
import { applyVerifiedPaymentReview, type VerifiedPaymentReview } from "./payment-review.ts";
import {
  acceptSandboxWebhook,
  acceptConfiguredWebhook,
  recoverStripeEvent,
  type SandboxOrder,
  type SandboxProvider,
  type SandboxCommerce,
  type SandboxWebhookConfig,
} from "./stripe-adapter.ts";
import { liveCheckoutSettings } from "./checkout-settings.ts";
import { liveWebhookConfiguration } from "./stripe-webhook-http.ts";
import { createSandboxWebhookHandler, sandboxWebhookConfiguration } from "./stripe-webhook-http.ts";

const secret = "whsec_generated_local_test_fixture_only";
const stripe = new Stripe("sk_test_local_signature_fixture_only");
const config: SandboxWebhookConfig = {
  webhookSecret: secret,
  expectedAccountId: "acct_fixture",
  expectedLivemode: false,
  environment: "staging",
};

test("recovery retrieves the exact event and retains account, mode and amount verification", async () => {
  const f = fixture();
  const event = JSON.parse(envelope(f.session).raw) as Stripe.Event;
  const provider = {
    ...f.provider,
    event: async (id: string) => {
      assert.equal(id, "evt_fixture");
      return event;
    },
  };
  await recoverStripeEvent("evt_fixture", config, provider, f.commerce);
  assert.equal(f.applied.length, 1);
  await assert.rejects(
    recoverStripeEvent("evt_wrong", config, { ...provider, event: async () => event }, f.commerce),
    /identity mismatch/,
  );
  await assert.rejects(
    recoverStripeEvent(
      "evt_fixture",
      config,
      { ...provider, accountId: async () => "acct_other" },
      f.commerce,
    ),
    /account/,
  );
  await assert.rejects(
    recoverStripeEvent(
      "evt_fixture",
      config,
      { ...provider, event: async () => ({ ...event, livemode: true }) },
      f.commerce,
    ),
    /Live-mode/,
  );
  f.intent.amount_received = 1;
  await assert.rejects(recoverStripeEvent("evt_fixture", config, provider, f.commerce));
  assert.equal(f.applied.length, 1);
});
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

test("live tax payments require separate mode, verified inclusive totals and atomic settlement", async () => {
  const f = fixture();
  const liveConfig = {
    webhookSecret: secret,
    expectedAccountId: "acct_fixture",
    expectedLivemode: true as const,
    environment: "production" as const,
    taxMode: "stripe" as const,
  };
  Object.assign(f.session, {
    id: "cs_live_fixture",
    livemode: true,
    amount_subtotal: 2500,
    amount_total: 2675,
    total_details: { amount_tax: 175, amount_discount: 0, amount_shipping: 0 },
    automatic_tax: { enabled: true, status: "complete" },
    metadata: { wgp_order_id: "order", wgp_quote_id: "quote", wgp_environment: "production" },
  });
  f.order.provider_session_id = f.session.id;
  Object.assign(f.intent, { livemode: true, amount: 2675, amount_received: 2675 });
  Object.assign(f.paidCharge, { livemode: true, amount: 2675, amount_captured: 2675 });
  let settlements = 0;
  f.commerce.applyTaxed = async (event, tax, review) => {
    assert.equal(tax, 175);
    assert.equal(event.amountCents, 2675);
    assert.equal(review, false);
    settlements++;
    return { status: "paid" };
  };
  const event = envelope(f.session, "checkout.session.completed", { livemode: true });
  assert.equal(
    (await acceptConfiguredWebhook(event.raw, event.signature, liveConfig, f.provider, f.commerce))
      .applied,
    "paid",
  );
  assert.equal(settlements, 1);
  assert.equal(f.applied.length, 0);
  await assert.rejects(
    acceptSandboxWebhook(event.raw, event.signature, config, f.provider, f.commerce),
    /Live-mode/,
  );
  f.intent.amount_received = 2500;
  await assert.rejects(
    acceptConfiguredWebhook(event.raw, event.signature, liveConfig, f.provider, f.commerce),
    /paid amount/,
  );
  assert.equal(settlements, 1);
  f.intent.amount_received = 2675;
  f.session.automatic_tax.status = "failed";
  await assert.rejects(
    acceptConfiguredWebhook(event.raw, event.signature, liveConfig, f.provider, f.commerce),
    /tax calculation/,
  );
  assert.equal(settlements, 1);
});

test("live configuration cannot inherit sandbox approval or mixed credentials", () => {
  const values: Record<string, string> = {
    CATALOG_ENV: "production",
    BETTER_AUTH_URL: "https://photos.example.com",
    CATALOG_LIVE_RELEASE_ACCEPTED: "true",
    CATALOG_LIVE_TAX_ACCEPTED: "true",
    CATALOG_LIVE_DELIVERY_ACCEPTED: "true",
    CATALOG_LIVE_CHECKOUT_ENABLED: "true",
    CATALOG_LIVE_DOWNLOADS_ENABLED: "true",
    CATALOG_LIVE_STRIPE_SECRET_KEY: "sk_live_fixture",
    CATALOG_LIVE_STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    CATALOG_LIVE_STRIPE_ACCOUNT_ID: "acct_fixture",
    CATALOG_STRIPE_DIGITAL_TAX_CODE: "txcd_12345678",
    CATALOG_LIVE_WEBHOOK_ENABLED: "true",
  };
  const get = (key: string) => values[key] || "";
  assert.equal(liveCheckoutSettings(get)?.environment, "production");
  assert.equal(liveWebhookConfiguration(get)?.expectedLivemode, true);
  for (const key of [
    "CATALOG_LIVE_RELEASE_ACCEPTED",
    "CATALOG_LIVE_TAX_ACCEPTED",
    "CATALOG_LIVE_DELIVERY_ACCEPTED",
    "CATALOG_LIVE_WEBHOOK_ENABLED",
    "CATALOG_LIVE_DOWNLOADS_ENABLED",
    "CATALOG_LIVE_STRIPE_ACCOUNT_ID",
    "CATALOG_STRIPE_DIGITAL_TAX_CODE",
  ])
    assert.equal(
      liveCheckoutSettings((name) => (name === key ? "" : get(name))),
      undefined,
    );
  assert.equal(
    liveCheckoutSettings((name) => (name === "CATALOG_ENV" ? "staging" : get(name))),
    undefined,
  );
  assert.equal(
    liveCheckoutSettings((name) =>
      name === "CATALOG_LIVE_STRIPE_SECRET_KEY" ? "sk_test_fixture" : get(name),
    ),
    undefined,
  );
  values.CATALOG_LIVE_CHECKOUT_ENABLED = "false";
  assert.equal(liveCheckoutSettings(get), undefined);
  assert.ok(
    liveCheckoutSettings(get, true),
    "Cancel remains possible while new checkout is disabled",
  );
  assert.ok(liveWebhookConfiguration(get), "Webhooks stay active while new checkout is disabled");
});

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
  await assert.rejects(f.send("charge.refunded", f.charge), /review ledger/);
  f.charge.amount_refunded = 2500;
  assert.equal((await f.send("charge.refunded", f.charge)).applied, "refunded");
  assert.equal(f.applied[0].kind, "refunded");
});
test("unsupported event types and malformed dispute objects are not acknowledged", async () => {
  const f = fixture();
  for (const type of ["refund.updated"]) await assert.rejects(f.send(type), /not implemented/);
  assert.equal(f.calls(), 0);
  await assert.rejects(f.send("charge.dispute.created"), /Invalid dispute object/);
  assert.equal(f.applied.length, 0);
});
test("verified partial refunds and disputes hold all delivery without creating paid events", async () => {
  const f = fixture(),
    reviews: VerifiedPaymentReview[] = [];
  f.order.provider_payment_id = "pi_fixture";
  f.commerce.applyReview = async (event) => {
    reviews.push(event);
    return { status: "review" };
  };
  f.charge.refunded = false;
  f.charge.amount_refunded = 100;
  assert.equal((await f.send("charge.refunded", f.charge)).applied, "review");
  assert.equal(reviews[0].kind, "partial_refund");
  const dispute = {
    id: "dp_fixture",
    object: "dispute",
    livemode: false,
    charge: "ch_fixture",
    status: "won",
  } as Stripe.Dispute;
  f.provider.dispute = async () => dispute;
  for (const type of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"])
    assert.equal((await f.send(type, dispute)).applied, "review");
  assert.equal(reviews.length, 4);
  assert.equal(f.applied.length, 0);
  f.provider.dispute = async () => ({ ...dispute, livemode: true });
  await assert.rejects(f.send("charge.dispute.created", dispute), /Dispute identity/);
  assert.equal(reviews.length, 4);
});
test("refund-before-payment resolution rejects foreign provider metadata and Session identity", async () => {
  const f = fixture();
  let reviews = 0;
  f.commerce.orderByPayment = async () => undefined;
  f.commerce.orderById = async (id) => (id === f.order.id ? f.order : undefined);
  f.commerce.applyReview = async () => {
    reviews++;
    return { status: "refunded" };
  };
  f.intent.metadata = {
    wgp_order_id: f.order.id,
    wgp_quote_id: "foreign",
    wgp_environment: "staging",
  };
  await assert.rejects(f.send("charge.refunded", f.charge), /quote mismatch/);
  f.intent.metadata.wgp_quote_id = f.order.quote_id;
  f.session.payment_intent = "pi_foreign";
  await assert.rejects(f.send("charge.refunded", f.charge), /payment identity/);
  assert.equal(reviews, 0);
  f.session.payment_intent = "pi_fixture";
  assert.equal((await f.send("charge.refunded", f.charge)).applied, "refunded");
  assert.equal(reviews, 1);
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
test("HTTP verifies exact chunked UTF-8 bytes and rejects a reserialized signed body", async () => {
  const f = fixture();
  const handler = createSandboxWebhookHandler(config, f.provider, f.commerce);
  const event = envelope({ ...f.session, description: "CCES — José 📷" });
  const bytes = new TextEncoder().encode(event.raw);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Split every multi-byte code point across chunks. Decode only after
      // assembling the bounded body; never parse/re-serialize before HMAC.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const response = await handler(
    new Request("https://example.test/api/commerce-webhook", {
      method: "POST",
      headers: { "stripe-signature": event.signature },
      body: stream,
      duplex: "half",
    } as RequestInit),
  );
  assert.equal(response.status, 200);
  assert.equal(f.applied.length, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const before = f.calls();
  const changed = await handler(
    new Request("https://example.test/api/commerce-webhook", {
      method: "POST",
      headers: { "stripe-signature": event.signature },
      body: JSON.stringify(JSON.parse(event.raw), null, 2),
    }),
  );
  assert.equal(changed.status, 400);
  assert.equal(f.calls(), before);
  assert.equal(f.applied.length, 1);
});

test("HTTP provider/read failures return retryable safe errors and never acknowledge payment", async () => {
  const f = fixture();
  const event = envelope(f.session);
  const handler = createSandboxWebhookHandler(config, f.provider, f.commerce);
  f.provider.session = async () => {
    throw new Error("sensitive provider diagnostics and private object location");
  };
  const outage = await handler(
    new Request("https://example.test/api/commerce-webhook", {
      method: "POST",
      headers: { "stripe-signature": event.signature },
      body: event.raw,
    }),
  );
  assert.equal(outage.status, 503);
  assert.doesNotMatch(await outage.text(), /sensitive|diagnostics|object location/);
  assert.equal(f.applied.length, 0);

  const before = f.calls();
  const failedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("private transport diagnostics"));
    },
  });
  const disconnected = await handler(
    new Request("https://example.test/api/commerce-webhook", {
      method: "POST",
      headers: { "stripe-signature": event.signature },
      body: failedBody,
      duplex: "half",
    } as RequestInit),
  );
  assert.equal(disconnected.status, 503);
  assert.doesNotMatch(await disconnected.text(), /private transport/);
  assert.equal(f.calls(), before);
  assert.equal(f.applied.length, 0);
});

test("signed paid replay and signed full refund exercise the real database state machine", async () => {
  const db = new PGlite();
  try {
    for (const name of [
      "0005_catalog.sql",
      "0006_photo_management.sql",
      "0008_commerce.sql",
      "0011_commerce_session_outcomes.sql",
      "0018_payment_reviews.sql",
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
      orderById: (id) => lookup("o.id", id),
      applyReview: (event) => applyVerifiedPaymentReview(sql, event),
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
    // A real-provider refund can arrive before any paid webhook. Resolve only
    // through retrieved PaymentIntent metadata + the exact bound local Session.
    const q2 = await commerce.quote("customer", {
      galleryId: "gallery",
      items: [{ productId: "digital", photoId: "photo", quantity: 1 }],
    });
    const o2 = await commerce.orderForQuote("customer", q2.id);
    await commerce.bindProviderSession(o2.id, "cs_test_pendingrefund");
    f.session.id = "cs_test_pendingrefund";
    f.session.client_reference_id = o2.id;
    f.session.metadata = { wgp_order_id: o2.id, wgp_quote_id: q2.id, wgp_environment: "staging" };
    f.session.payment_intent = "pi_pendingrefund";
    f.charge.payment_intent = "pi_pendingrefund";
    f.intent.id = "pi_pendingrefund";
    f.intent.metadata = { ...f.session.metadata };
    const early = envelope(f.charge, "charge.refunded", { id: "evt_earlyrefund" });
    await acceptSandboxWebhook(early.raw, early.signature, config, f.provider, domain);
    await acceptSandboxWebhook(early.raw, early.signature, config, f.provider, domain);
    assert.equal((await commerce.customerOrder("customer", o2.id)).status, "refunded");
    assert.equal(
      (await db.query("SELECT * FROM commerce_entitlements WHERE order_id=$1", [o2.id])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("SELECT * FROM commerce_payment_reviews WHERE order_id=$1", [o2.id])).rows
        .length,
      1,
    );
    await assert.rejects(
      commerce.applyVerifiedPayment({
        eventId: "evt_delayed",
        orderId: o2.id,
        kind: "paid",
        sessionId: f.session.id,
        paymentId: "pi_pendingrefund",
        amountCents: 2500,
        currency: "usd",
      }),
      /Invalid payment transition/,
    );
    await assert.rejects(
      applyVerifiedPaymentReview(sql, {
        eventId: "evt_earlyrefund",
        orderId: o2.id,
        kind: "dispute",
        sessionId: f.session.id,
        paymentId: "pi_pendingrefund",
        amountCents: 2500,
        currency: "usd",
      }),
      /Conflicting event replay/,
    );
    for (const kind of ["partial_refund", "dispute"] as const) {
      const quote = await commerce.quote("customer", {
        galleryId: "gallery",
        items: [{ productId: "digital", photoId: "photo", quantity: 1 }],
      });
      const order = await commerce.orderForQuote("customer", quote.id),
        sid = `cs_test_${kind}`,
        pid = `pi_${kind}`;
      await commerce.bindProviderSession(order.id, sid);
      await commerce.applyVerifiedPayment({
        eventId: `evt_paid_${kind}`,
        orderId: order.id,
        kind: "paid",
        sessionId: sid,
        paymentId: pid,
        amountCents: 2500,
        currency: "usd",
      });
      const review: VerifiedPaymentReview = {
        eventId: `evt_review_${kind}`,
        orderId: order.id,
        kind,
        sessionId: sid,
        paymentId: pid,
        amountCents: 2500,
        currency: "usd",
      };
      await assert.rejects(
        applyVerifiedPaymentReview(sql, { ...review, paymentId: "pi_foreign" }),
        /identity mismatch/,
      );
      assert.equal((await commerce.customerOrder("customer", order.id)).status, "paid");
      await applyVerifiedPaymentReview(sql, review);
      await applyVerifiedPaymentReview(sql, review);
      assert.equal((await commerce.customerOrder("customer", order.id)).status, "review");
      const grants = await db.query<{ revoked_at: unknown; token_hash: unknown }>(
        "SELECT revoked_at,token_hash FROM commerce_entitlements WHERE order_id=$1",
        [order.id],
      );
      assert.ok(grants.rows[0].revoked_at);
      assert.equal(grants.rows[0].token_hash, null);
      await assert.rejects(
        commerce.applyVerifiedPayment({
          eventId: `evt_late_${kind}`,
          orderId: order.id,
          kind: "paid",
          sessionId: sid,
          paymentId: pid,
          amountCents: 2500,
          currency: "usd",
        }),
        /Invalid payment transition/,
      );
      // A later full refund converges safely; another dispute cannot revive it.
      await applyVerifiedPaymentReview(sql, {
        ...review,
        eventId: `evt_full_${kind}`,
        kind: "full_refund",
      });
      await applyVerifiedPaymentReview(sql, {
        ...review,
        eventId: `evt_dispute_later_${kind}`,
        kind: "dispute",
      });
      assert.equal((await commerce.customerOrder("customer", order.id)).status, "refunded");
    }
  } finally {
    await db.close();
  }
});
