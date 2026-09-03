import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getStripeSecrets } = await import("@/lib/secrets.server");
        const secrets = await getStripeSecrets();
        if (!secrets?.webhookSecret) return new Response("Webhook secret missing", { status: 400 });
        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(secrets.secretKey);
        const raw = await request.text();
        const sig = request.headers.get("stripe-signature") || "";
        let event;
        try {
          event = stripe.webhooks.constructEvent(raw, sig, secrets.webhookSecret);
        } catch {
          return new Response("Invalid signature", { status: 400 });
        }
        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const { getSql } = await import("@/lib/db");
          const sql = await getSql();
          const seen = await sql<{
            event_id: string;
          }>`select event_id from stripe_webhook_events where event_id = ${event.id}`;
          if (seen[0]) return new Response("ok");
          const id = session.id;
          const existing = await sql<{
            id: string;
          }>`select id from shop_orders where stripe_session_id = ${id}`;
          if (!existing[0]) {
            const extra = session as typeof session & {
              shipping_details?: {
                name?: string | null;
                address?: {
                  line1?: string | null;
                  line2?: string | null;
                  city?: string | null;
                  state?: string | null;
                  postal_code?: string | null;
                  country?: string | null;
                } | null;
              } | null;
              collected_information?: {
                shipping_details?: {
                  name?: string | null;
                  address?: {
                    line1?: string | null;
                    line2?: string | null;
                    city?: string | null;
                    state?: string | null;
                    postal_code?: string | null;
                    country?: string | null;
                  } | null;
                } | null;
              };
            };
            const shipping =
              extra.collected_information?.shipping_details ?? extra.shipping_details;
            const addr = shipping?.address;
            const items = session.metadata?.items || "[]";
            const number = `WG-${String(Date.now()).slice(-6)}`;
            await sql`
              insert into shop_orders (
                id, number, status, buyer_name, buyer_email, note, items_json,
                subtotal, discount, tax, shipping, total, shipping_json,
                stripe_session_id, stripe_payment_intent_id, paid_at
              ) values (
                ${crypto.randomUUID()},
                ${number},
                ${"new"},
                ${session.metadata?.buyerName || shipping?.name || session.customer_details?.name || "Guest"},
                ${session.customer_email || session.customer_details?.email || ""},
                ${session.metadata?.note || ""},
                ${items},
                ${session.amount_subtotal ?? 0},
                ${0},
                ${session.total_details?.amount_tax ?? 0},
                ${session.total_details?.amount_shipping ?? 0},
                ${session.amount_total ?? 0},
                ${JSON.stringify({
                  name: shipping?.name,
                  line1: addr?.line1,
                  line2: addr?.line2,
                  city: addr?.city,
                  state: addr?.state,
                  postal: addr?.postal_code,
                  country: addr?.country,
                })},
                ${id},
                ${typeof session.payment_intent === "string" ? session.payment_intent : ""},
                ${new Date().toISOString()}
              )
            `;
          }
          await sql`
            insert into stripe_webhook_events (event_id, event_type)
            values (${event.id}, ${event.type})
            on conflict (event_id) do nothing
          `;
        } else {
          // Record successfully verified events even when this version does
          // not need to act on them, preventing repeated processing on retry.
          const { getSql } = await import("@/lib/db");
          const sql = await getSql();
          await sql`
            insert into stripe_webhook_events (event_id, event_type)
            values (${event.id}, ${event.type})
            on conflict (event_id) do nothing
          `;
        }
        return new Response("ok");
      },
    },
  },
});
