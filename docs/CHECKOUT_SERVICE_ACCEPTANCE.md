# Sandbox checkout service slice

Status: **implemented building block; not exposed, enabled, or provider-tested**.

`src/lib/catalog-commerce/checkout.server.ts` creates a Stripe-hosted Checkout Session from a database quote. No route imports it. This does not enable purchases or claim that checkout works on the website.

## Implemented safeguards

- Strict input accepts only a quote ID. The caller must derive the customer ID from authenticated identity, never request JSON.
- Reads customer-owned, unexpired snapshots and rechecks publication, current access version, photo readiness/visibility/archive state, plus the caller's current password/access authorization callback.
- Existing `commerce_create_order` locks the quote and returns one unique order. The stable order ID is the Stripe idempotency key. A provider timeout before local binding can retry identical parameters.
- Integer-cent discount allocation preserves the exact immutable quote total without client totals, names, tax, coupon objects, or object keys.
- Requires staging, an `sk_test_` credential, correct direct Stripe account, and separate checkout, delivery-acceptance, and sandbox-tax-fixture flags. No live key or Connect mode is accepted.
- Only the configured HTTPS origin can be used for the fixed return routes. Returned redirects must use `https://checkout.stripe.com`.
- Retrieves the provider session and checks test mode, amount, currency, metadata, customer reference, pending status, and URL before compare-and-set binding. No payment/entitlement state is granted by this service.
- Zero tax is a deliberately gated **sandbox fixture only**, not a tax determination. Live charging is impossible in this adapter.

## Verified locally

PGlite integration test covers one logical order, repeated calls, provider read failure before binding, identical retry parameters, foreign customer, extra browser amount, disabled flags, wrong account, live key/mode, incorrect redirect, access denial, hidden photo, and access-version revocation. Discount allocation is exercised for every discount from 0 through 610 cents against a 611-cent snapshot. These tests do not prove independent-connection PostgreSQL contention or Stripe behavior.

## Must finish before any activation

1. Wire an authenticated, same-origin/CSRF-protected POST route, rate limits, safe errors, and the fixed `/checkout/complete` and `/checkout/cancel` pages. A return page must never grant delivery.
2. Select seller/tax/license/refund policy and implement an authoritative tax adapter; do not reuse the fixture gate for live mode.
3. Define and implement session expiry, cancellation and reconciliation for revoked gallery access, photo removal, abandoned checkout and expired quotes. Rechecking before redirect does not retract an already issued Stripe URL. Without that lifecycle, a customer could pay after access is revoked; therefore this slice must remain unwired.
4. Freeze callback configuration for retries or persist complete request parameters per order before supporting deployment/configuration changes during pending checkout.
5. If allowing retries beyond the current quote-expiry window, persist provider-attempt state and protect against Stripe idempotency-key retention expiry. The present implementation refuses an expired quote.
6. Test concurrent creation using independent PostgreSQL connections and actual sandbox provider idempotency; run checkout → signed webhook → authorized download → full refund → revoked download, including duplicate events and provider timeouts.
7. Complete customer receipt/history and download UX, policy notices, and an explicit staging acceptance decision. Keep checkout/delivery independently disabled until then.

No credentials, payment account settings, real orders, publication settings, or provider state were changed by this implementation.

Provider reference: [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create).
