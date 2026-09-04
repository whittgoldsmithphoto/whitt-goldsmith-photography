import type Stripe from "stripe";

/** Validate provider-calculated exclusive tax without trusting browser totals.
 * Base is the immutable, already-discounted local price snapshot. Stripe coupons
 * and shipping are forbidden on this digital-only integration.
 */
export function verifiedCheckoutTax(
  session: Stripe.Checkout.Session,
  baseCents: number,
  requireFinal = true,
): number {
  const cents = (value: unknown): value is number =>
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100000000;
  const tax = session.total_details?.amount_tax;
  if (
    !cents(baseCents) ||
    !cents(tax) ||
    !cents(session.amount_total) ||
    session.currency !== "usd" ||
    session.amount_subtotal !== baseCents ||
    session.amount_total !== baseCents + tax ||
    session.total_details?.amount_discount !== 0 ||
    session.total_details?.amount_shipping !== 0 ||
    session.automatic_tax?.enabled !== true ||
    (requireFinal && session.automatic_tax.status !== "complete") ||
    session.automatic_tax.status === "failed"
  )
    throw new Error("Stripe tax calculation does not match the quoted price");
  return tax;
}
