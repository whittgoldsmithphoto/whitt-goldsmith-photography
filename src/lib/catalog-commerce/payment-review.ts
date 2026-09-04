import { z } from "zod";
import type { Sql } from "../db.ts";
export interface VerifiedPaymentReview {
  eventId: string;
  orderId: string;
  sessionId: string;
  paymentId: string;
  kind: "partial_refund" | "full_refund" | "dispute";
  amountCents: number;
  currency: "usd";
}
export async function applyVerifiedPaymentReview(sql: Sql, input: VerifiedPaymentReview) {
  const id = z.string().min(1).max(150);
  const value = z
    .object({
      eventId: id,
      orderId: id,
      sessionId: id,
      paymentId: id,
      kind: z.enum(["partial_refund", "full_refund", "dispute"]),
      amountCents: z.number().int().min(0).max(100000000),
      currency: z.literal("usd"),
    })
    .strict()
    .parse(input);
  const [row] = await sql.query<{ status: string }>(
    "SELECT * FROM commerce_apply_payment_review($1,$2,$3,$4,$5,$6,$7)",
    [
      value.eventId,
      value.orderId,
      value.sessionId,
      value.paymentId,
      value.kind,
      value.amountCents,
      value.currency,
    ],
  );
  return row;
}
