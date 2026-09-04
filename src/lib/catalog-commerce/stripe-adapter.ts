import Stripe from "stripe";
import type { VerifiedPayment } from "./service.ts";
import type { VerifiedSessionOutcome } from "./session-outcomes.ts";
import type { VerifiedPaymentReview } from "./payment-review.ts";
import { verifiedCheckoutTax } from "./stripe-tax.ts";

export class CommerceWebhookError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export interface SandboxOrder {
  id: string;
  quote_id: string;
  provider_session_id: string | null;
  provider_payment_id: string | null;
  total_cents: number;
  currency: string;
  tax_cents?: number;
}
export interface SandboxProvider {
  accountId(): Promise<string>;
  session(id: string): Promise<Stripe.Checkout.Session>;
  paymentIntent(id: string): Promise<Stripe.PaymentIntent>;
  charge(id: string): Promise<Stripe.Charge>;
  dispute?(id: string): Promise<Stripe.Dispute>;
}
export interface SandboxCommerce {
  orderBySession(sessionId: string): Promise<SandboxOrder | undefined>;
  orderByPayment(paymentId: string): Promise<SandboxOrder | undefined>;
  apply(payment: VerifiedPayment): Promise<unknown>;
  applySessionOutcome(event: VerifiedSessionOutcome): Promise<{ status: string }>;
  orderById?(id: string): Promise<SandboxOrder | undefined>;
  applyReview?(event: VerifiedPaymentReview): Promise<{ status: string }>;
  applyTaxed?(
    event: VerifiedPayment | VerifiedPaymentReview,
    taxCents: number,
    review: boolean,
  ): Promise<{ status: string }>;
}
export interface SandboxWebhookConfig {
  webhookSecret: string;
  expectedAccountId: string;
  expectedLivemode: false;
  environment: "staging";
  taxMode?: "stripe";
}
export interface LiveWebhookConfig {
  webhookSecret: string;
  expectedAccountId: string;
  expectedLivemode: true;
  environment: "production";
  taxMode: "stripe";
}
function fail(message: string, status = 400): never {
  throw new CommerceWebhookError(message, status);
}
function reference(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

/** SANDBOX ONLY. The Stripe SDK verifies the exact raw bytes using WebCrypto.
 * Provider readback is required after signature verification: event metadata alone
 * never authorizes fulfillment. No checkout/session-creation capability exists.
 */
export async function acceptSandboxWebhook(
  rawBody: string,
  signature: string,
  config: SandboxWebhookConfig,
  provider: SandboxProvider,
  commerce: SandboxCommerce,
) {
  if (config.environment !== "staging" || config.expectedLivemode !== false)
    fail("Sandbox webhook is not configured", 503);
  return acceptConfiguredWebhook(rawBody, signature, config, provider, commerce);
}

export async function acceptConfiguredWebhook(
  rawBody: string,
  signature: string,
  config: SandboxWebhookConfig | LiveWebhookConfig,
  provider: SandboxProvider,
  commerce: SandboxCommerce,
) {
  const live = config.environment === "production";
  if (
    !["staging", "production"].includes(config.environment) ||
    config.expectedLivemode !== live ||
    (live && config.taxMode !== "stripe") ||
    !/^acct_[A-Za-z0-9]+$/.test(config.expectedAccountId) ||
    !config.webhookSecret.startsWith("whsec_")
  )
    fail("Sandbox webhook is not configured", 503);
  // This key is never sent anywhere; SDK webhooks do not make network requests.
  const verifier = new Stripe("sk_test_local_signature_verifier_only");
  let event: Stripe.Event;
  try {
    event = await verifier.webhooks.constructEventAsync(
      rawBody,
      signature,
      config.webhookSecret,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    fail("Invalid webhook signature", 400);
  }
  // Stripe SDK enforces maximum age but not a timestamp far in the future.
  // Bound both directions without changing its HMAC/raw-body verification.
  const timestamps = signature
    .split(",")
    .filter((part) => part.startsWith("t="))
    .map((part) => Number(part.slice(2)));
  if (
    timestamps.length !== 1 ||
    !Number.isSafeInteger(timestamps[0]) ||
    timestamps[0] > Math.floor(Date.now() / 1000) + 300
  )
    fail("Invalid webhook signature timestamp", 400);
  return acceptProviderEvent(event, config, provider, commerce);
}

/** Server-only recovery path: retrieve by ID using the configured account key.
 * Never expose an HTTP operation accepting a caller-supplied event object.
 */
export async function recoverStripeEvent(
  eventId: string,
  config: SandboxWebhookConfig | LiveWebhookConfig,
  provider: SandboxProvider & { event(id: string): Promise<Stripe.Event> },
  commerce: SandboxCommerce,
) {
  if (!/^evt_[A-Za-z0-9]+$/.test(eventId)) fail("Invalid event identity");
  const event = await provider.event(eventId);
  if (event.id !== eventId) fail("Recovered event identity mismatch", 409);
  return acceptProviderEvent(event, config, provider, commerce);
}

async function acceptProviderEvent(
  event: Stripe.Event,
  config: SandboxWebhookConfig | LiveWebhookConfig,
  provider: SandboxProvider,
  commerce: SandboxCommerce,
) {
  const live = config.environment === "production";
  if (
    !["staging", "production"].includes(config.environment) ||
    config.expectedLivemode !== live ||
    (live && config.taxMode !== "stripe") ||
    !/^acct_[A-Za-z0-9]+$/.test(config.expectedAccountId)
  )
    fail("Payment event configuration is invalid", 503);
  if (event.livemode !== live)
    fail(
      live
        ? "Test-mode events are forbidden on this live endpoint"
        : "Live-mode events are forbidden on this sandbox endpoint",
    );
  if (!event.id?.startsWith("evt_")) fail("Invalid event identity");
  // This adapter is for a direct account, not Connect or organization destinations.
  if (event.account || (event as Stripe.Event & { context?: string }).context)
    fail("Connected-account and organization events are unsupported", 422);
  const supported = [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "charge.refunded",
    "checkout.session.expired",
    "checkout.session.async_payment_failed",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
  ];
  if (!supported.includes(event.type))
    fail("Event type is not implemented; no order state was changed", 422);
  if ((await provider.accountId()) !== config.expectedAccountId)
    fail("Stripe account does not match sandbox configuration", 409);

  function validateSession(
    session: Stripe.Checkout.Session,
    order: SandboxOrder,
    allowPending = false,
    expectedStatus: "complete" | "expired" = "complete",
  ) {
    if (config.taxMode === "stripe") {
      const base = order.total_cents - (order.tax_cents || 0);
      const tax = verifiedCheckoutTax(session, base, expectedStatus === "complete");
      order.total_cents = base + tax;
      order.tax_cents = tax;
    }
    if (
      session.object !== "checkout.session" ||
      session.livemode !== live ||
      session.mode !== "payment" ||
      session.id !== order.provider_session_id ||
      session.status !== expectedStatus ||
      (!allowPending && session.payment_status !== "paid") ||
      session.client_reference_id !== order.id ||
      session.metadata?.wgp_order_id !== order.id ||
      session.metadata?.wgp_quote_id !== order.quote_id ||
      session.metadata?.wgp_environment !== config.environment ||
      session.amount_total !== order.total_cents ||
      session.currency !== order.currency ||
      order.currency !== "usd"
    )
      fail("Verified Checkout Session does not match the local order", 409);
    const paymentId = reference(session.payment_intent);
    if (
      (!allowPending && !paymentId?.startsWith("pi_")) ||
      (order.provider_payment_id && order.provider_payment_id !== paymentId)
    )
      fail("Verified Checkout Session payment identity does not match", 409);
    return paymentId;
  }

  if (event.type === "charge.refunded" || event.type.startsWith("charge.dispute.")) {
    const isDispute = event.type.startsWith("charge.dispute.");
    let chargeId: string;
    if (isDispute) {
      const supplied = event.data.object as Stripe.Dispute;
      if (
        supplied.object !== "dispute" ||
        supplied.livemode !== live ||
        !supplied.id?.startsWith("dp_")
      )
        fail("Invalid dispute object");
      if (!provider.dispute) fail("Dispute readback is unavailable", 503);
      const dispute = await provider.dispute(supplied.id);
      if (
        dispute.id !== supplied.id ||
        dispute.object !== "dispute" ||
        dispute.livemode !== live ||
        !reference(dispute.charge)?.startsWith("ch_")
      )
        fail("Dispute identity mismatch", 409);
      chargeId = reference(dispute.charge)!;
    } else {
      const supplied = event.data.object as Stripe.Charge;
      if (
        supplied.object !== "charge" ||
        supplied.livemode !== live ||
        !supplied.id?.startsWith("ch_")
      )
        fail("Invalid refund object");
      chargeId = supplied.id;
    }
    const charge = await provider.charge(chargeId);
    if (
      charge.id !== chargeId ||
      charge.object !== "charge" ||
      charge.livemode !== live ||
      !charge.paid ||
      (!isDispute &&
        (!Number.isSafeInteger(charge.amount_refunded) ||
          charge.amount_refunded <= 0 ||
          charge.amount_refunded > charge.amount))
    )
      fail("Refund or dispute charge is not confirmed", 422);
    const paymentId = reference(charge.payment_intent);
    if (!paymentId) fail("Refund payment identity is missing", 409);
    let order = await commerce.orderByPayment(paymentId);
    // Refunds can precede the paid webhook. Retrieve the PaymentIntent rather
    // than trusting event metadata, then validate its bound local Session below.
    if (!order && commerce.orderById) {
      const intent = await provider.paymentIntent(paymentId);
      if (
        intent.id !== paymentId ||
        intent.object !== "payment_intent" ||
        intent.livemode !== live ||
        intent.amount !== charge.amount ||
        intent.currency !== charge.currency ||
        intent.metadata?.wgp_environment !== config.environment ||
        !intent.metadata?.wgp_order_id
      )
        fail("Adverse payment identity mismatch", 409);
      order = await commerce.orderById(intent.metadata.wgp_order_id);
      if (order && intent.metadata.wgp_quote_id !== order.quote_id)
        fail("Adverse payment quote mismatch", 409);
    }
    if (
      !order?.provider_session_id ||
      (order.provider_payment_id === null && !commerce.applyReview) ||
      (order.provider_payment_id !== null && order.provider_payment_id !== paymentId) ||
      (config.taxMode !== "stripe" && charge.amount !== order.total_cents) ||
      charge.currency !== order.currency
    )
      fail("Refund does not match a paid local order", 409);
    const session = await provider.session(order.provider_session_id);
    if (validateSession(session, order) !== paymentId)
      fail("Refund payment identity does not match session", 409);
    if (charge.amount !== order.total_cents)
      fail("Refund total does not match tax-inclusive amount", 409);
    const fullRefund = charge.refunded && charge.amount_refunded === charge.amount;
    if (commerce.applyReview) {
      const review: VerifiedPaymentReview = {
        eventId: event.id,
        orderId: order.id,
        kind: isDispute ? "dispute" : fullRefund ? "full_refund" : "partial_refund",
        sessionId: session.id,
        paymentId,
        amountCents: order.total_cents,
        currency: "usd",
      };
      if (config.taxMode === "stripe" && !commerce.applyTaxed)
        fail("Tax settlement is unavailable", 503);
      const result =
        config.taxMode === "stripe"
          ? await commerce.applyTaxed!(review, order.tax_cents!, true)
          : await commerce.applyReview(review);
      return {
        received: true,
        applied: result.status === "refunded" ? ("refunded" as const) : ("review" as const),
      };
    }
    if (config.taxMode === "stripe" || isDispute || !fullRefund)
      fail("Payment review ledger is unavailable", 503);
    await commerce.apply({
      eventId: event.id,
      orderId: order.id,
      kind: "refunded",
      sessionId: session.id,
      paymentId,
      amountCents: order.total_cents,
      currency: "usd",
    });
    return { received: true, applied: "refunded" as const };
  }

  const supplied = event.data.object as Stripe.Checkout.Session;
  if (
    supplied.object !== "checkout.session" ||
    supplied.livemode !== live ||
    !supplied.id?.startsWith(live ? "cs_live_" : "cs_test_")
  )
    fail("Invalid sandbox Checkout Session");
  const session = await provider.session(supplied.id);
  if (session.id !== supplied.id || session.livemode !== live)
    fail("Provider session identity or mode mismatch", 409);
  const order = await commerce.orderBySession(session.id);
  if (!order) fail("Checkout Session has no bound local order", 409);
  if (
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const expired = event.type === "checkout.session.expired";
    const recordedTotal = order.total_cents;
    validateSession(session, order, true, expired ? "expired" : "complete");
    if (session.payment_status !== "unpaid") fail("Session outcome is not confirmed unpaid", 409);
    const paymentId = reference(session.payment_intent) || null;
    if (!expired && !paymentId)
      fail("Failed asynchronous payment has no verifiable PaymentIntent", 422);
    if (paymentId) {
      const intent = await provider.paymentIntent(paymentId);
      if (
        intent.id !== paymentId ||
        intent.object !== "payment_intent" ||
        intent.livemode !== live ||
        intent.amount !== order.total_cents ||
        intent.currency !== order.currency ||
        intent.amount_received !== 0 ||
        !["requires_payment_method", "canceled"].includes(intent.status)
      )
        fail("PaymentIntent is not a confirmed unpaid terminal failure", 409);
    }
    const result = await commerce.applySessionOutcome({
      eventId: event.id,
      orderId: order.id,
      kind: expired ? "expired" : "async_failed",
      sessionId: session.id,
      paymentId,
      amountCents: recordedTotal,
      currency: "usd",
    });
    return {
      received: true,
      applied: result.status === "failed" ? ("failed" as const) : ("none" as const),
    };
  }
  if (event.type === "checkout.session.completed" && session.payment_status === "unpaid") {
    validateSession(session, order, true);
    // A delayed payment completion is acknowledged as pending, never fulfilled.
    // The later async success event must pass all checks before any grant exists.
    return { received: true, applied: "none" as const, reason: "Payment is still pending" };
  }
  const paymentId = validateSession(session, order);
  if (!paymentId) fail("Payment identity missing", 409);
  // A Checkout Session stays 'paid' after a refund. Reconcile the PaymentIntent
  // and its expanded latest charge before any delayed success can grant access.
  const intent = await provider.paymentIntent(paymentId);
  if (
    intent.id !== paymentId ||
    intent.object !== "payment_intent" ||
    intent.livemode !== live ||
    intent.status !== "succeeded" ||
    intent.amount !== order.total_cents ||
    intent.amount_received !== order.total_cents ||
    intent.currency !== order.currency
  )
    fail("PaymentIntent does not confirm the local paid amount", 409);
  const charge = intent.latest_charge;
  if (
    !charge ||
    typeof charge === "string" ||
    charge.object !== "charge" ||
    charge.livemode !== live ||
    reference(charge.payment_intent) !== paymentId ||
    !charge.paid ||
    !charge.captured ||
    charge.refunded ||
    charge.amount_refunded !== 0 ||
    charge.disputed ||
    charge.amount !== order.total_cents ||
    charge.amount_captured !== order.total_cents ||
    charge.currency !== order.currency
  )
    fail("Latest charge is not an undisputed, unrefunded full payment", 409);
  const payment: VerifiedPayment = {
    eventId: event.id,
    orderId: order.id,
    kind: "paid",
    sessionId: session.id,
    paymentId,
    amountCents: order.total_cents,
    currency: "usd",
  };
  if (config.taxMode === "stripe") {
    if (!commerce.applyTaxed) fail("Tax settlement is unavailable", 503);
    await commerce.applyTaxed(payment, order.tax_cents!, false);
  } else await commerce.apply(payment);
  return { received: true, applied: "paid" as const };
}
