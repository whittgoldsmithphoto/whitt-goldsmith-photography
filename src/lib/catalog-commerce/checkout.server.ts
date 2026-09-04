import Stripe from "stripe";
import { z } from "zod";
import type { Sql } from "../db.ts";
import { createCommerce, type Quote, type Order } from "./service.ts";

/** Not exposed by an HTTP route. Sandbox acceptance must precede activation. */
export interface CheckoutConfiguration {
  environment: string;
  checkoutEnabled: boolean;
  deliveryAccepted: boolean;
  sandboxTaxFixtureAccepted: boolean;
  secretKey: string;
  accountId: string;
  origin: string;
}
export interface CheckoutProvider {
  accountId(): Promise<string>;
  create(
    params: Stripe.Checkout.SessionCreateParams,
    key: string,
  ): Promise<Stripe.Checkout.Session>;
  retrieve(id: string): Promise<Stripe.Checkout.Session>;
}
export class CheckoutError extends Error {}

function configuration(config: CheckoutConfiguration) {
  if (
    config.environment !== "staging" ||
    config.checkoutEnabled !== true ||
    config.deliveryAccepted !== true ||
    config.sandboxTaxFixtureAccepted !== true ||
    !/^sk_test_[A-Za-z0-9_]+$/.test(config.secretKey) ||
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

/** SDK adapter uses direct-account test credentials only; never Connect headers. */
export function stripeCheckoutProvider(config: CheckoutConfiguration): CheckoutProvider {
  configuration(config);
  const stripe = new Stripe(config.secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10000,
    maxNetworkRetries: 1,
  });
  return {
    accountId: async () => (await stripe.accounts.retrieve(null)).id,
    create: (params, key) => stripe.checkout.sessions.create(params, { idempotencyKey: key }),
    retrieve: (id) => stripe.checkout.sessions.retrieve(id),
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
    if (item.kind !== "digital_photo" || item.unitCents * item.quantity !== item.lineCents)
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
  async function snapshot(customerId: string, quoteId: string) {
    const [quote] = await sql.query<Quote>(
      `SELECT q.* FROM commerce_quotes q JOIN catalog_galleries g ON g.id=q.gallery_id
       WHERE q.id=$1 AND q.customer_id=$2 AND q.status IN ('open','ordered') AND q.expires_at>now()
       AND g.published AND g.visibility<>'private' AND g.access_version=q.access_version
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.items) i
         LEFT JOIN catalog_photos p ON p.id=i->>'photoId'
         WHERE p.id IS NULL OR p.gallery_id<>q.gallery_id OR p.status<>'ready' OR p.hidden OR p.archived)`,
      [quoteId, customerId],
    );
    if (!quote) throw new CheckoutError("Quote or gallery is no longer available");
    await authorizeGallery(quote.gallery_id);
    return quote;
  }
  return async (customerId: string, input: unknown) => {
    configuration(config);
    z.string().trim().min(1).max(150).parse(customerId);
    const { quoteId } = z
      .object({ quoteId: z.string().min(1).max(150) })
      .strict()
      .parse(input);
    const quote = await snapshot(customerId, quoteId);
    const lines = checkoutLines(quote);
    if ((await provider.accountId()) !== config.accountId)
      throw new CheckoutError("Stripe sandbox account mismatch");
    const order = await commerce.orderForQuote(customerId, quoteId);
    if (order.status !== "pending") throw new CheckoutError("Order is not pending");
    const metadata = { wgp_order_id: order.id, wgp_quote_id: quoteId, wgp_environment: "staging" };
    // Stable parameters and order key survive a provider timeout before local bind.
    const created = order.provider_session_id
      ? null
      : await provider.create(
          {
            mode: "payment",
            payment_method_types: ["card"],
            client_reference_id: order.id,
            metadata,
            payment_intent_data: { metadata },
            line_items: lines,
            success_url: `${config.origin}/checkout/complete`,
            cancel_url: `${config.origin}/checkout/cancel`,
            allow_promotion_codes: false,
            automatic_tax: { enabled: false },
          },
          order.id,
        );
    const sessionId = order.provider_session_id ?? created?.id;
    if (!sessionId?.startsWith("cs_test_")) throw new CheckoutError("Invalid sandbox session");
    const session = await provider.retrieve(sessionId);
    if (
      session.id !== sessionId ||
      session.object !== "checkout.session" ||
      session.livemode !== false ||
      session.mode !== "payment" ||
      session.status !== "open" ||
      session.payment_status !== "unpaid" ||
      session.client_reference_id !== order.id ||
      session.metadata?.wgp_order_id !== order.id ||
      session.metadata?.wgp_quote_id !== quoteId ||
      session.metadata?.wgp_environment !== "staging" ||
      session.amount_total !== quote.total_cents ||
      session.currency !== "usd" ||
      !session.url
    )
      throw new CheckoutError("Stripe session does not match the pending order");
    const checkoutUrl = new URL(session.url);
    if (
      checkoutUrl.origin !== "https://checkout.stripe.com" ||
      checkoutUrl.username ||
      checkoutUrl.password
    )
      throw new CheckoutError("Invalid Stripe checkout destination");
    await snapshot(customerId, quoteId);
    const bound: Order = await commerce.bindProviderSession(order.id, sessionId);
    return { orderId: bound.id, sessionId, url: session.url };
  };
}
