import Stripe from "stripe";
import { getSql } from "../db";
import { runtimeSetting } from "../catalog/media.server";
import { createCommerce } from "./service";
import { applyVerifiedSessionOutcome } from "./session-outcomes";
import type { SandboxOrder } from "./stripe-adapter";
import { createSandboxWebhookHandler, sandboxWebhookConfiguration } from "./stripe-webhook-http";

export async function catalogStripeWebhook(request: Request) {
  const config = sandboxWebhookConfiguration(runtimeSetting);
  if (!config)
    return Response.json(
      { error: "Catalog sandbox webhook is disabled" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  const stripe = new Stripe(runtimeSetting("CATALOG_STRIPE_SECRET_KEY"), {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10000,
    maxNetworkRetries: 1,
  });
  async function order(column: "provider_session_id" | "provider_payment_id", value: string) {
    const sql = await getSql();
    return (
      await sql.query<SandboxOrder>(
        `SELECT o.id,o.quote_id,o.provider_session_id,o.provider_payment_id,q.total_cents,q.currency
      FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id WHERE o.${column}=$1`,
        [value],
      )
    )[0];
  }
  return createSandboxWebhookHandler(
    config,
    {
      accountId: async () => (await stripe.accounts.retrieve(null)).id,
      session: (id) => stripe.checkout.sessions.retrieve(id),
      paymentIntent: (id) => stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] }),
      charge: (id) => stripe.charges.retrieve(id),
    },
    {
      orderBySession: (id) => order("provider_session_id", id),
      orderByPayment: (id) => order("provider_payment_id", id),
      apply: async (event) =>
        createCommerce(await getSql(), async () => {
          throw new Error("Webhook cannot authorize galleries");
        }).applyVerifiedPayment(event),
      applySessionOutcome: async (event) => applyVerifiedSessionOutcome(await getSql(), event),
    },
  )(request);
}
