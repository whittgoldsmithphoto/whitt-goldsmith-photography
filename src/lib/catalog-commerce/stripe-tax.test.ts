import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { verifiedCheckoutTax } from "./stripe-tax.ts";

test("exclusive Stripe tax preserves base prices and verifies complete arithmetic", () => {
  const session = {
    currency: "usd",
    amount_subtotal: 2500,
    amount_total: 2675,
    total_details: { amount_tax: 175, amount_shipping: 0, amount_discount: 0 },
    automatic_tax: { enabled: true, status: "complete" },
  } as Stripe.Checkout.Session;
  assert.equal(verifiedCheckoutTax(session, 2500), 175);
  assert.equal(
    verifiedCheckoutTax(
      {
        ...session,
        amount_total: 2500,
        total_details: { ...session.total_details!, amount_tax: 0 },
      },
      2500,
    ),
    0,
  );
  for (const patch of [
    { amount_subtotal: 2400 },
    { amount_total: 1 },
    { currency: "eur" },
    { automatic_tax: { enabled: false, status: "complete" } },
    { automatic_tax: { enabled: true, status: "requires_location_inputs" } },
    { automatic_tax: { enabled: true, status: "failed" } },
    ...[-1, 0.1, null, 100000001].map((amount_tax) => ({
      total_details: { ...session.total_details, amount_tax },
    })),
    { total_details: { ...session.total_details, amount_discount: 1 } },
    { total_details: { ...session.total_details, amount_shipping: 1 } },
  ])
    assert.throws(() =>
      verifiedCheckoutTax({ ...session, ...patch } as Stripe.Checkout.Session, 2500),
    );
  const open = {
    ...session,
    automatic_tax: { enabled: true, status: "requires_location_inputs" },
  } as Stripe.Checkout.Session;
  assert.equal(verifiedCheckoutTax(open, 2500, false), 175);
});
