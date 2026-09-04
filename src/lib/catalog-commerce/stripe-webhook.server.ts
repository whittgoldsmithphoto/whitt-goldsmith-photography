import Stripe from "stripe";
import { getSql } from "../db";
import { runtimeSetting } from "../catalog/media.server";
import { stripeCommerceLedger } from "./stripe-ledger.ts";
import {
  createConfiguredWebhookHandler,
  sandboxWebhookConfiguration,
  liveWebhookConfiguration,
} from "./stripe-webhook-http";

export async function catalogStripeWebhook(request: Request) {
  const config =
    sandboxWebhookConfiguration(runtimeSetting) ?? liveWebhookConfiguration(runtimeSetting);
  if (!config)
    return Response.json(
      { error: "Catalog sandbox webhook is disabled" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  const stripe = new Stripe(
    runtimeSetting(
      config.environment === "production"
        ? "CATALOG_LIVE_STRIPE_SECRET_KEY"
        : "CATALOG_STRIPE_SECRET_KEY",
    ),
    {
      httpClient: Stripe.createFetchHttpClient(),
      timeout: 10000,
      maxNetworkRetries: 1,
    },
  );
  return createConfiguredWebhookHandler(
    config,
    {
      accountId: async () => (await stripe.accounts.retrieve(null)).id,
      session: (id) => stripe.checkout.sessions.retrieve(id),
      paymentIntent: (id) => stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] }),
      charge: (id) => stripe.charges.retrieve(id),
      dispute: (id) => stripe.disputes.retrieve(id),
    },
    stripeCommerceLedger(() => getSql()),
  )(request);
}
