import { z } from "zod";
import type { Sql } from "../db.ts";
import type { Order } from "./service.ts";

export interface VerifiedSessionOutcome {
  eventId: string;
  orderId: string;
  kind: "expired" | "async_failed";
  sessionId: string;
  paymentId: string | null;
  amountCents: number;
  currency: "usd";
}
/** Internal provider domain only; never an owner/browser-supplied payment status.
 * Requires migration0011; missing migration fails rather than acknowledging.
 */
export async function applyVerifiedSessionOutcome(
  sql: Sql,
  input: VerifiedSessionOutcome,
): Promise<Order> {
  const id = z.string().min(1).max(150);
  const event = z
    .object({
      eventId: id,
      orderId: id,
      kind: z.enum(["expired", "async_failed"]),
      sessionId: id,
      paymentId: id.nullable(),
      amountCents: z.number().int().min(0).max(100000000),
      currency: z.literal("usd"),
    })
    .strict()
    .parse(input);
  const [row] = await sql.query<Order>(
    `SELECT * FROM commerce_apply_session_outcome($1,$2,$3,$4,$5,$6,$7)`,
    [
      event.eventId,
      event.orderId,
      event.kind,
      event.sessionId,
      event.paymentId,
      event.amountCents,
      event.currency,
    ],
  );
  return row;
}
