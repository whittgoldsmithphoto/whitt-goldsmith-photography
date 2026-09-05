import Stripe from "stripe";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { createCommerce, type Quote, type Order } from "./service.ts";
import { verifiedCheckoutTax } from "./stripe-tax.ts";

/** Explicit, isolated payment configuration. Live and sandbox credentials never mix. */
export interface CheckoutConfiguration {
  environment: string;
  checkoutEnabled: boolean;
  deliveryAccepted: boolean;
  sandboxTaxFixtureAccepted: boolean;
  secretKey: string;
  accountId: string;
  origin: string;
  taxMode?: "stripe";
  digitalTaxCode?: string;
  liveAccepted?: boolean;
}
export interface CheckoutProvider {
  accountId(): Promise<string>;
  preflight?(): Promise<void>;
  create(
    params: Stripe.Checkout.SessionCreateParams,
    key: string,
  ): Promise<Stripe.Checkout.Session>;
  retrieve(id: string): Promise<Stripe.Checkout.Session>;
  expire(id: string): Promise<Stripe.Checkout.Session>;
  findSessions(input: {
    createdAfter: number;
    createdBefore: number;
    orderId: string;
    quoteId: string;
  }): Promise<{ sessions: Stripe.Checkout.Session[]; complete: boolean }>;
}
export class CheckoutError extends Error {
  readonly status = 503;
}

/** An empty registration list is not proof of exemption or a provider failure.
 * Keep automatic tax and the separate release-acceptance gate; never fabricate
 * a registration just to let digital-only checkout pass provider preflight.
 */
export function assertStripeTaxConfiguration(
  config: Pick<CheckoutConfiguration, "environment" | "digitalTaxCode">,
  tax: {
    livemode: boolean;
    status: string;
    defaults: { provider?: string; tax_code?: string | null };
  },
  registrations: {
    has_more: boolean;
    data: Array<{
      livemode: boolean;
      country: string;
      country_options: { us?: { state: string } };
    }>;
  },
) {
  if (tax.livemode !== (config.environment === "production"))
    throw new CheckoutError("Stripe Tax mode does not match this checkout environment");
  if (tax.status !== "active")
    throw new CheckoutError(
      "Stripe Tax setup is not active; complete Tax settings in the matching Stripe account",
    );
  if (tax.defaults.provider !== "stripe")
    throw new CheckoutError("Stripe Tax provider does not match the reviewed configuration");
  if (tax.defaults.tax_code !== config.digitalTaxCode)
    throw new CheckoutError(
      "Stripe Tax product category does not match the reviewed website configuration; review both before retrying",
    );
  if (registrations.has_more)
    throw new CheckoutError("Stripe Tax registration list is incomplete; owner review required");
  if (
    registrations.data.some(
      (reg) =>
        reg.livemode !== (config.environment === "production") ||
        reg.country !== "US" ||
        reg.country_options.us?.state !== "SC",
    )
  )
    throw new CheckoutError(
      "Stripe Tax registrations differ from the reviewed South Carolina configuration",
    );
}

function configuration(config: CheckoutConfiguration, requireAcceptance = true) {
  if (
    !["staging", "production"].includes(config.environment) ||
    (config.environment === "production" &&
      (config.liveAccepted !== true || config.taxMode !== "stripe")) ||
    (config.taxMode === "stripe" && !/^txcd_[0-9]{8}$/.test(config.digitalTaxCode || "")) ||
    (requireAcceptance &&
      (config.checkoutEnabled !== true ||
        config.deliveryAccepted !== true ||
        config.sandboxTaxFixtureAccepted !== true)) ||
    !(
      config.environment === "production" ? /^sk_live_[A-Za-z0-9_]+$/ : /^sk_test_[A-Za-z0-9_]+$/
    ).test(config.secretKey) ||
    !/^acct_[A-Za-z0-9]+$/.test(config.accountId)
  )
    throw new CheckoutError("Sandbox checkout is disabled");
  const origin = new URL(config.origin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== config.origin ||
    origin.username ||
    origin.password
  )
    throw new CheckoutError("Checkout origin must be an explicit HTTPS origin");
}

/** SDK adapter uses direct-account credentials; never Connect headers. */
export function stripeCheckoutProvider(config: CheckoutConfiguration): CheckoutProvider {
  configuration(config, false);
  const stripe = new Stripe(config.secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10000,
    maxNetworkRetries: 1,
  });
  return {
    accountId: async () => (await stripe.accounts.retrieve(null)).id,
    preflight: async () => {
      const account = await stripe.accounts.retrieve(null);
      if (
        config.environment === "production" &&
        (!account.charges_enabled || !account.payouts_enabled)
      )
        throw new CheckoutError("Stripe payments and payouts must be enabled");
      if (config.taxMode === "stripe") {
        const [tax, registrations] = await Promise.all([
          stripe.tax.settings.retrieve(),
          stripe.tax.registrations.list({ status: "active", limit: 100 }),
        ]);
        assertStripeTaxConfiguration(config, tax, registrations);
      }
    },
    create: (params, key) => stripe.checkout.sessions.create(params, { idempotencyKey: key }),
    retrieve: (id) => stripe.checkout.sessions.retrieve(id),
    expire: (id) => stripe.checkout.sessions.expire(id),
    findSessions: async (input) => {
      const sessions: Stripe.Checkout.Session[] = [];
      let startingAfter: string | undefined;
      for (let page = 0; page < 5; page++) {
        const result = await stripe.checkout.sessions.list({
          created: { gte: input.createdAfter, lte: input.createdBefore },
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        sessions.push(
          ...result.data.filter(
            (session) =>
              session.client_reference_id === input.orderId &&
              session.metadata?.wgp_order_id === input.orderId &&
              session.metadata?.wgp_quote_id === input.quoteId &&
              session.metadata?.wgp_environment === config.environment,
          ),
        );
        if (!result.has_more) return { sessions, complete: true };
        startingAfter = result.data.at(-1)?.id;
        if (!startingAfter) break;
      }
      return { sessions, complete: false };
    },
  };
}

/** Allocate snapshot discount in integer cents; never create mutable Stripe coupons.
 * Each Checkout line is the complete quoted quantity, avoiding fractional cents.
 */
export function checkoutLines(quote: Quote): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const cents = z.number().int().min(0).max(100000000);
  for (const amount of [quote.subtotal_cents, quote.discount_cents, quote.total_cents])
    cents.parse(amount);
  if (
    quote.currency !== "usd" ||
    quote.tax_cents !== 0 ||
    quote.shipping_cents !== 0 ||
    quote.total_cents < 1 ||
    quote.subtotal_cents - quote.discount_cents !== quote.total_cents ||
    !quote.items.length ||
    quote.items.length > 100
  )
    throw new CheckoutError("Unsupported sandbox quote totals");
  let subtotal = 0;
  const amounts = quote.items.map((item) => {
    cents.parse(item.unitCents);
    cents.parse(item.lineCents);
    z.number().int().min(1).max(99).parse(item.quantity);
    z.string().min(1).max(160).parse(item.name);
    if (
      !["digital_photo", "gallery_download"].includes(item.kind) ||
      item.unitCents * item.quantity !== item.lineCents
    )
      throw new CheckoutError("Invalid quote snapshot");
    subtotal += item.lineCents;
    return (
      item.lineCents -
      Number((BigInt(item.lineCents) * BigInt(quote.discount_cents)) / BigInt(quote.subtotal_cents))
    );
  });
  if (subtotal !== quote.subtotal_cents) throw new CheckoutError("Invalid quote subtotal");
  let remainder = amounts.reduce((sum, amount) => sum + amount, 0) - quote.total_cents;
  return quote.items.map((item, index) => {
    const adjustment = Math.min(remainder, amounts[index]);
    remainder -= adjustment;
    return {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amounts[index] - adjustment,
        product_data: {
          name: item.name,
          description: `Quantity: ${item.quantity}. License retained in your order record.`,
        },
      },
    };
  });
}

export function createSandboxCheckout(
  sql: Sql,
  authorizeGallery: (galleryId: string) => Promise<number>,
  config: CheckoutConfiguration,
  provider: CheckoutProvider,
) {
  const commerce = createCommerce(sql, authorizeGallery);
  type Attempt = {
    order_id: string;
    account_id: string;
    origin: string;
    environment: string;
    params: Stripe.Checkout.SessionCreateParams;
    expires_at: Date | string;
    created_at: Date | string;
    provider_session_id: string | null;
    state: string;
  };
  async function attempt(orderId: string) {
    return (
      await sql.query<Attempt>("SELECT * FROM commerce_checkout_attempts WHERE order_id=$1", [
        orderId,
      ])
    )[0];
  }
  async function ownedOrder(customerId: string, quoteId: string) {
    return (
      await sql.query<Order>("SELECT * FROM commerce_orders WHERE quote_id=$1 AND customer_id=$2", [
        quoteId,
        customerId,
      ])
    )[0];
  }
  async function account() {
    if ((await provider.accountId()) !== config.accountId)
      throw new CheckoutError("Stripe sandbox account mismatch");
  }
  function sessionMatches(session: Stripe.Checkout.Session, order: Order, saved: Attempt) {
    const amount = saved.params.line_items?.reduce(
      (sum, item) => sum + (item.price_data?.unit_amount ?? -100000000) * (item.quantity ?? 0),
      0,
    );
    if (
      !session.id.startsWith(config.environment === "production" ? "cs_live_" : "cs_test_") ||
      session.object !== "checkout.session" ||
      session.livemode !== (config.environment === "production") ||
      session.mode !== "payment" ||
      session.client_reference_id !== order.id ||
      session.metadata?.wgp_order_id !== order.id ||
      session.metadata?.wgp_quote_id !== order.quote_id ||
      session.metadata?.wgp_environment !== config.environment ||
      (config.taxMode !== "stripe" && session.amount_total !== amount) ||
      session.currency !== "usd" ||
      session.expires_at !== saved.params.expires_at ||
      (saved.provider_session_id && saved.provider_session_id !== session.id)
    )
      throw new CheckoutError("Stripe session does not match the pending order");
    if (config.taxMode === "stripe")
      verifiedCheckoutTax(session, amount!, session.status === "complete");
  }
  async function resolveSession(order: Order, saved: Attempt) {
    if (saved.account_id !== config.accountId || saved.environment !== config.environment)
      throw new CheckoutError("Checkout account changed");
    const id = saved.provider_session_id ?? order.provider_session_id;
    let session: Stripe.Checkout.Session;
    if (id) session = await provider.retrieve(id);
    else if (new Date(saved.expires_at).getTime() < Date.now() + 1800_000) {
      // Never replay an invalid/past creation timestamp. Find the existing session
      // using a bounded read-only scan, then verify every locked snapshot field.
      const found = await provider.findSessions({
        createdAfter: Math.floor(new Date(saved.created_at).getTime() / 1000) - 60,
        createdBefore: Math.floor(new Date(saved.expires_at).getTime() / 1000),
        orderId: order.id,
        quoteId: order.quote_id,
      });
      if (!found.complete || found.sessions.length !== 1)
        throw new CheckoutError(
          "Unbound checkout requires provider reconciliation; creation window elapsed and session lookup was not definitive",
        );
      session = found.sessions[0];
    } else session = await provider.create(saved.params, order.id);
    sessionMatches(session, order, saved);
    const [recorded] = await sql.query<Attempt>(
      `UPDATE commerce_checkout_attempts SET provider_session_id=$2,updated_at=now()
      WHERE order_id=$1 AND (provider_session_id IS NULL OR provider_session_id=$2) RETURNING *`,
      [order.id, session.id],
    );
    if (!recorded) throw new CheckoutError("Checkout session identity changed");
    return session;
  }
  async function expireOrder(order: Order) {
    let saved = await attempt(order.id);
    if (!saved) throw new CheckoutError("No recorded checkout to cancel");
    if (saved.state === "expired") return { orderId: order.id, status: "expired" as const };
    await account();
    if (saved.account_id !== config.accountId) throw new CheckoutError("Checkout account changed");
    await sql.query(
      `UPDATE commerce_checkout_attempts SET state='cancel_requested',updated_at=now()
      WHERE order_id=$1 AND state IN ('reserved','bound')`,
      [order.id],
    );
    saved = (await attempt(order.id))!;
    // Recover an ambiguous create by replaying the exact original idempotent request.
    // A failure remains cancel_requested, never eligible to be redirected again.
    let session = await resolveSession(order, saved);
    // Bind before expiry so its webhook can resolve a recovered ambiguous create.
    // No payment or failure state is granted by this binding.
    if (order.status === "pending" && !order.provider_session_id)
      await commerce.bindProviderSession(order.id, session.id);
    if (session.status === "open") {
      await provider.expire(session.id);
      session = await provider.retrieve(session.id);
      sessionMatches(session, order, saved);
    }
    if (session.status === "complete") {
      await sql.query(
        "UPDATE commerce_checkout_attempts SET state='complete',updated_at=now() WHERE order_id=$1",
        [order.id],
      );
      throw new CheckoutError("Payment already completed; refund reconciliation is required");
    }
    if (session.status !== "expired")
      throw new CheckoutError("Stripe cancellation has not been confirmed");
    await sql.query(
      "UPDATE commerce_checkout_attempts SET state='expired',updated_at=now() WHERE order_id=$1",
      [order.id],
    );
    return { orderId: order.id, status: "expired" as const };
  }
  async function snapshot(customerId: string, quoteId: string) {
    const [quote] = await sql.query<Quote>(
      `SELECT q.* FROM commerce_quotes q JOIN catalog_galleries g ON g.id=q.gallery_id
       WHERE q.id=$1 AND q.customer_id=$2 AND
       ((q.status='open' AND q.expires_at>now()) OR (q.status='ordered' AND q.expires_at>now() AND NOT EXISTS (
         SELECT 1 FROM commerce_orders o JOIN commerce_checkout_attempts a ON a.order_id=o.id WHERE o.quote_id=q.id)) OR (q.status='ordered' AND EXISTS (
         SELECT 1 FROM commerce_orders o JOIN commerce_checkout_attempts a ON a.order_id=o.id
         WHERE o.quote_id=q.id AND o.customer_id=q.customer_id AND o.status='pending'
         AND a.expires_at>now() AND a.state IN ('reserved','bound'))))
       AND g.published AND g.visibility<>'private' AND g.access_version=q.access_version
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.items) i
         LEFT JOIN catalog_photos p ON p.id=i->>'photoId'
         WHERE p.id IS NULL OR p.gallery_id<>q.gallery_id OR p.status<>'ready' OR p.hidden OR p.archived)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.items) i
         CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(i->'photoIds','[]'::jsonb)) ids
         LEFT JOIN catalog_photos p ON p.id=ids
         WHERE i->>'kind'='gallery_download' AND
           (p.id IS NULL OR p.gallery_id<>q.gallery_id OR p.status<>'ready' OR p.hidden OR p.archived))`,
      [quoteId, customerId],
    );
    if (!quote) throw new CheckoutError("Quote or gallery is no longer available");
    await authorizeGallery(quote.gallery_id);
    return quote;
  }
  function inputValues(customerId: string, input: unknown, requireAcceptance = true) {
    configuration(config, requireAcceptance);
    z.string().trim().min(1).max(150).parse(customerId);
    return z
      .object({ quoteId: z.string().min(1).max(150) })
      .strict()
      .parse(input);
  }
  const checkout = async (customerId: string, input: unknown) => {
    const { quoteId } = inputValues(customerId, input);
    await provider.preflight?.();
    let quote: Quote;
    try {
      quote = await snapshot(customerId, quoteId);
    } catch (error) {
      const existing = await ownedOrder(customerId, quoteId);
      if (existing && (await attempt(existing.id))) await expireOrder(existing);
      throw error;
    }
    const lines = checkoutLines(quote);
    await account();
    const order = await commerce.orderForQuote(customerId, quoteId);
    if (order.status !== "pending") throw new CheckoutError("Order is not pending");
    const metadata = {
      wgp_order_id: order.id,
      wgp_quote_id: quoteId,
      wgp_environment: config.environment,
    };
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: order.id,
      metadata,
      payment_intent_data: { metadata },
      line_items:
        config.taxMode === "stripe"
          ? lines.map((line) => ({
              ...line,
              price_data: {
                ...line.price_data!,
                tax_behavior: "exclusive",
                product_data: {
                  ...line.price_data!.product_data!,
                  tax_code: config.digitalTaxCode,
                },
              },
            }))
          : lines,
      success_url: `${config.origin}/checkout/complete?orderId=${encodeURIComponent(order.id)}`,
      cancel_url: `${config.origin}/checkout/cancel?orderId=${encodeURIComponent(order.id)}`,
      allow_promotion_codes: false,
      automatic_tax: { enabled: config.taxMode === "stripe" },
      ...(config.taxMode === "stripe" ? { billing_address_collection: "required" as const } : {}),
      expires_at: expiresAt,
    };
    await sql.query(
      `INSERT INTO commerce_checkout_attempts(order_id,account_id,origin,environment,params,expires_at)
      VALUES($1,$2,$3,$6,$4::jsonb,to_timestamp($5)) ON CONFLICT(order_id) DO NOTHING`,
      [
        order.id,
        config.accountId,
        config.origin,
        JSON.stringify(params),
        expiresAt,
        config.environment,
      ],
    );
    const saved = (await attempt(order.id))!;
    if (!["reserved", "bound"].includes(saved.state))
      throw new CheckoutError("Checkout has been cancelled");
    if (new Date(saved.expires_at).getTime() <= Date.now()) {
      await expireOrder(order);
      throw new CheckoutError("Checkout expired");
    }
    await resolveSession(order, saved);
    const recorded = (await attempt(order.id))!;
    const sessionId = recorded.provider_session_id!;
    const session = await provider.retrieve(sessionId);
    sessionMatches(session, order, recorded);
    if (session.status === "complete" || session.status === "expired") {
      // Resolve late webhooks even if payment/expiry beat the create response.
      await commerce.bindProviderSession(order.id, sessionId);
      await sql.query(
        "UPDATE commerce_checkout_attempts SET state=$2,updated_at=now() WHERE order_id=$1",
        [order.id, session.status],
      );
      throw new CheckoutError(
        session.status === "complete"
          ? "Payment already completed; refresh order status for verified confirmation"
          : "Checkout expired; create a new quote",
      );
    }
    if (session.status !== "open" || session.payment_status !== "unpaid" || !session.url)
      throw new CheckoutError("Stripe session does not match the pending order");
    const checkoutUrl = new URL(session.url);
    if (
      checkoutUrl.origin !== "https://checkout.stripe.com" ||
      checkoutUrl.username ||
      checkoutUrl.password
    )
      throw new CheckoutError("Invalid Stripe checkout destination");
    let bound: Order;
    try {
      await snapshot(customerId, quoteId);
      const [active] = await sql.query(
        `UPDATE commerce_checkout_attempts SET state='bound',updated_at=now()
        WHERE order_id=$1 AND state IN ('reserved','bound') AND expires_at>now() RETURNING order_id`,
        [order.id],
      );
      if (!active) throw new CheckoutError("Checkout cancelled or expired during creation");
      bound = await commerce.bindProviderSession(order.id, sessionId);
    } catch (error) {
      await expireOrder(order);
      throw error;
    }
    return { orderId: bound.id, sessionId, url: session.url };
  };
  return Object.assign(checkout, {
    cancel: async (customerId: string, input: unknown) => {
      const { quoteId } = inputValues(customerId, input, false);
      const order = await ownedOrder(customerId, quoteId);
      if (!order) throw new CheckoutError("Order unavailable");
      return expireOrder(order);
    },
  });
}
