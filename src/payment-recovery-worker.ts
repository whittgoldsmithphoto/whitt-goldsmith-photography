import Stripe from "stripe";
import { Pool } from "pg";
import type { Sql } from "./lib/db";
import {
  recoverPayments,
  recoveryEventTypes,
  recoveryConfiguration,
} from "./lib/catalog-commerce/recovery";
import { recoverStripeEvent } from "./lib/catalog-commerce/stripe-adapter";
import { stripeCommerceLedger } from "./lib/catalog-commerce/stripe-ledger";

type Environment = Record<string, unknown> & { HYPERDRIVE?: { connectionString: string } };
export default {
  // No public/manual recovery endpoint or caller-supplied event payloads.
  fetch() {
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller: unknown, env: Environment) {
    if (env.CATALOG_RECOVERY_ENABLED !== "true") return;
    const setting = (key: string) => (typeof env[key] === "string" ? (env[key] as string) : "");
    const setup = recoveryConfiguration(setting);
    if (!setup || !env.HYPERDRIVE?.connectionString) throw new Error("Recovery is not configured");
    const { config, secretKey } = setup;
    const stripe = new Stripe(secretKey, {
      httpClient: Stripe.createFetchHttpClient(),
      timeout: 10000,
      maxNetworkRetries: 1,
    });
    if ((await stripe.accounts.retrieve(null)).id !== config.expectedAccountId)
      throw new Error("Recovery account mismatch");
    const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 2 });
    const sql = Object.assign(
      async () => {
        throw new Error("Use parameterized query");
      },
      {
        query: async <T>(text: string, params: unknown[] = []) =>
          (await pool.query(text, params)).rows as T[],
      },
    ) as Sql;
    try {
      const result = await recoverPayments(
        sql,
        `${config.environment}:${config.expectedAccountId}`,
        {
          list: async (start, end, cursor) => {
            const page = await stripe.events.list({
              created: { gte: start, lte: end },
              types: recoveryEventTypes,
              limit: 100,
              ...(cursor ? { starting_after: cursor } : {}),
            });
            return { ids: page.data.map((event) => event.id), more: page.has_more };
          },
          apply: (id) =>
            recoverStripeEvent(
              id,
              config,
              {
                accountId: async () => (await stripe.accounts.retrieve(null)).id,
                event: (id) => stripe.events.retrieve(id),
                session: (id) => stripe.checkout.sessions.retrieve(id),
                paymentIntent: (id) =>
                  stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] }),
                charge: (id) => stripe.charges.retrieve(id),
                dispute: (id) => stripe.disputes.retrieve(id),
              },
              stripeCommerceLedger(async () => sql),
            ),
        },
      );
      console.log("payment_recovery", result);
    } catch {
      throw new Error("Payment recovery failed; inspect durable recovery status");
    } finally {
      await pool.end();
    }
  },
};
