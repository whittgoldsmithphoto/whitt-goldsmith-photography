import type { Sql } from "../db.ts";
import type { SandboxOrder, SandboxCommerce } from "./stripe-adapter.ts";
import { createCommerce } from "./service.ts";
import { applyVerifiedSessionOutcome } from "./session-outcomes.ts";
import { applyVerifiedPaymentReview } from "./payment-review.ts";

export function stripeCommerceLedger(database: () => Promise<Sql>): SandboxCommerce {
  async function order(
    column: "provider_session_id" | "provider_payment_id" | "id",
    value: string,
  ) {
    const sql = await database();
    return (
      await sql.query<SandboxOrder>(
        `SELECT o.id,o.quote_id,o.provider_session_id,o.provider_payment_id,q.total_cents,q.tax_cents,q.currency
      FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id WHERE o.${column}=$1`,
        [value],
      )
    )[0];
  }
  return {
    orderBySession: (id) => order("provider_session_id", id),
    orderByPayment: (id) => order("provider_payment_id", id),
    orderById: (id) => order("id", id),
    applyReview: async (event) => applyVerifiedPaymentReview(await database(), event),
    apply: async (event) =>
      createCommerce(await database(), async () => {
        throw new Error("Webhook cannot authorize galleries");
      }).applyVerifiedPayment(event),
    applySessionOutcome: async (event) => applyVerifiedSessionOutcome(await database(), event),
    applyTaxed: async (event, tax, review) => {
      const sql = await database();
      const [result] = await sql.query<{ status: string }>(
        "SELECT * FROM commerce_apply_taxed_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          event.eventId,
          event.orderId,
          event.sessionId,
          event.paymentId,
          event.kind,
          event.amountCents,
          tax,
          event.currency,
          review,
        ],
      );
      return result;
    },
  };
}
