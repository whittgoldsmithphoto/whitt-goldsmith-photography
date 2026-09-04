# Sandbox checkout acceptance

Status: **owner-only sandbox happy path, actual R2 download and full-refund revocation verified; test gates returned off**. See [deployed provider evidence](STRIPE_PROVIDER_ACCEPTANCE_2026-09-04.md). Other provider failure cases and all live-payment acceptance remain outstanding. Public checkout remains unavailable.

## Implemented boundaries

- Same-origin bounded JSON POST `commerce:checkout` derives identity from the session and requires configured owner capability. `commerce:payment-setup` exposes safe owner-only availability flags, never credentials. `commerce:cancel-checkout` also requires owner identity and rate limiting.
- Checkout uses customer-owned unexpired quote snapshots; it rechecks gallery access/version, publication, photo readiness/visibility/archive state and purchased-download policy. Browser prices, names, licenses and totals are not authoritative.
- Migration `0017_checkout_attempts.sql` persists immutable provider parameters, account, origin and expiration per order. Stable order IDs are provider idempotency keys; retries do not silently change callback configuration or quote contents. Expired unbound attempts fail closed for reconciliation rather than creating another session.
- Provider session readback validates test mode, account, amount, currency, metadata, customer reference, state and redirect. Redirects are restricted to Stripe Checkout and fixed HTTPS return routes. Returning from Stripe never changes payment state.
- Explicit cancellation records `cancel_requested` before calling the provider, confirms expiration before recording `expired`, and remains closed on provider failure. Already-paid sessions require refund/reconciliation. Automatic scheduled reconciliation and expiration after every catalog mutation remain outstanding.
- Migration `0018_payment_reviews.sql` records adverse provider outcomes and places partial refunds/disputes into a conservative delivery hold; full refunds revoke delivery. This is not a complete proportional partial-refund or dispute-resolution product.
- Migration `0019_checkout_rate_limits.sql` atomically caps authenticated checkout/cancellation attempts at 20 per ten-minute window.
- Test-only adapter requires staging, direct-account `sk_test_` credentials, matching account/webhook configuration, and independent checkout/delivery-fixture/tax-fixture gates. No live key or Connect mode is accepted. The zero-tax fixture is **not** a real tax determination.

## Customer interface

`/purchases` reads customer-scoped cursor-paginated history. `/checkout/complete` and `/checkout/cancel` display server-recorded status. Pending orders poll at most twelve times before offering manual refresh; errors stop automatic retries. Paid orders show eligible entitlements, remaining attempts and expiry. Review/refunded/failed statuses do not expose download controls.

Downloads POST an entitlement ID to `/api/commerce-download`, then POST its issued token in the request body. Tokens never enter URLs or browser persistence. The server rechecks identity, entitlement, current gallery policy, file state and original integrity before delivering bytes. Download capability remains independently gated.

## Verified locally

Service fixtures cover immutable retries, foreign customers, browser-total rejection, disabled/wrong environment credentials, provider response mismatches, access changes, expiry/cancellation and adverse-event handling. PGlite is not independent-connection Neon contention evidence.

`node scripts/commerce-customer-browser-check.mjs` passed with real local HTTP, Better Auth and PGlite. It covers account-isolated history/detail, pending-to-paid polling, cancellation-page non-mutation, exact downloaded fixture bytes through the actual authorization/integrity handler, attempt counting, other-account token denial, and refund UI/server revocation. Only the R2 binding and internal provider event inputs are synthetic. This is **not** proof of Stripe-hosted payment or live R2 acceptance. CI now runs this harness after the existing proof and resource browser checks; a configured step is not a claim the remote run passed.

## Gates still outstanding

1. Staging migrations and source deployment are verified. Preserve separate production configuration and migration acceptance before live activation.
2. Actual owner sandbox checkout, signed paid event, authorized private R2 download and full-refund revocation passed. Still verify duplicate-event readback/counts, declines/3DS, provider timeouts and independent PostgreSQL connection contention.
3. Reconcile stale/unbound attempts and unsettled orders with a scheduled durable job; expire outstanding Stripe URLs when catalog access changes, and test cancellation/payment races against Stripe.
4. Complete partial-refund allocation and dispute outcome resolution before claiming those workflows are fully supported; current policy is a conservative hold.
5. Decide real products/prices, seller jurisdiction, tax treatment, license/refund rules, receipt requirements and download limits. Implement a real tax adapter; never reuse sandbox zero-tax gates for live charging.
6. Build separate production configuration/account binding and a live-safe provider adapter. Audit legacy webhook consumers/records before changing their endpoint or secret source. Confirm verification/payout readiness and explicitly authorize a live acceptance purchase.

See [live setup findings](LIVE_STRIPE_READINESS.md). No current source gate certifies live readiness.
