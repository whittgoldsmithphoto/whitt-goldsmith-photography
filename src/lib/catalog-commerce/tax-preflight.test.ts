import { test } from "node:test";
import assert from "node:assert/strict";
import { assertStripeTaxConfiguration, checkoutLines } from "./checkout.server.ts";
import type { Quote } from "./service.ts";

const config = { environment: "production", digitalTaxCode: "txcd_10505000" };
const tax = {
  livemode: true,
  status: "active",
  defaults: { provider: "stripe", tax_code: config.digitalTaxCode },
};
const sc = { livemode: true, country: "US", country_options: { us: { state: "SC" } } };

test("digital provider preflight accepts no registrations without asserting exemption", () => {
  assert.doesNotThrow(() =>
    assertStripeTaxConfiguration(config, tax, { has_more: false, data: [] }),
  );
  assert.doesNotThrow(() =>
    assertStripeTaxConfiguration(config, tax, { has_more: false, data: [sc] }),
  );
});

test("digital preflight retains tax mode, classification and registration drift checks", () => {
  for (const invalid of [
    { ...tax, livemode: false },
    { ...tax, status: "pending" },
    { ...tax, defaults: { ...tax.defaults, provider: "other" } },
    { ...tax, defaults: { ...tax.defaults, tax_code: "txcd_00000000" } },
  ])
    assert.throws(() =>
      assertStripeTaxConfiguration(config, invalid, { has_more: false, data: [] }),
    );
  for (const registrations of [
    { has_more: true, data: [] },
    { has_more: false, data: [{ ...sc, livemode: false }] },
    { has_more: false, data: [{ ...sc, country: "CA" }] },
    { has_more: false, data: [{ ...sc, country_options: { us: { state: "NC" } } }] },
  ])
    assert.throws(() => assertStripeTaxConfiguration(config, tax, registrations));
});

test("digital-only checkout rejects physical and archive products", () => {
  for (const kind of ["print", "digital_gallery", "album"]) {
    const quote = {
      currency: "usd",
      tax_cents: 0,
      shipping_cents: 0,
      subtotal_cents: 100,
      discount_cents: 0,
      total_cents: 100,
      items: [{ kind, unitCents: 100, lineCents: 100, quantity: 1, name: "Not a single photo" }],
    } as unknown as Quote;
    assert.throws(() => checkoutLines(quote), /Invalid quote snapshot/);
  }
});
