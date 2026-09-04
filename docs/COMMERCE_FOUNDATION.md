# Commerce foundation — closed checkout

This is a real PostgreSQL-backed commerce domain and owner pricing editor, not a
claim of verified Stripe integration. Customer checkout stays unavailable.

## Implemented

- `/commerce`: owner-only product, license, default price list, explicit gallery
  override, integer-cent price and coupon configuration; saved order summary;
  authenticated one-photo quote preview.
- `/api/commerce`: public readiness status; authenticated quote previews and
  customer-scoped order reads; owner-only configuration mutations.
- Separate commerce tables in `0008_commerce.sql`, indexed foreign keys,
  constrained integer amounts and explicit unique provider identities.
- Authoritative digital-photo quote snapshots use current database products and
  prices. Unknown client fields (including amounts/names/licenses) are rejected.
- Gallery authorization occurs before quoting. Its revision is checked again
  under a database lock to reject authorization/settings races. Private, hidden,
  archived, processing, unavailable and duplicate selections fail closed.
- Quotes expire after 15 minutes; order creation is customer-scoped and
  idempotent. Gallery access version and photo availability are rechecked.
- Coupons validate scope, expiration, subtotal minimum and total usage. Row locks
  serialize reservation claims. Open quotes reserve until expiration; pending
  orders continue reserving until a verified terminal payment outcome.
- Internal provider-domain functions match event amount, currency, session and
  payment identity; duplicate events cannot increment consumption or grants
  twice. Full refunds revoke entitlements and tokens atomically.
- Download tokens contain 256 random bits and only their SHA-256 hashes are saved.
  Tokens require the matching customer, rotate on reissue, expire, revoke, and
  enforce a download limit. Reservations return a private object key internally,
  not an anonymous original URL. No public download handler is exposed yet.
- Every multistep quote/order/payment transition runs inside one PostgreSQL
  function call. This is intentional: Hyperdrive's request-safe SQL adapter opens
  a fresh connection per query, so JavaScript `BEGIN`/`COMMIT` across separate
  queries would not provide a transaction.

## Validation

`node --experimental-strip-types --test src/lib/catalog-commerce/commerce.test.ts`

Tests use a real in-memory PGlite/PostgreSQL engine, not a mocked SQL parser. They
cover price tampering, inheritance/overrides, availability, coupon claims and
release, quote expiry, scoped/idempotent orders, access-revision races, invalid
payment values, replay, failure, full refund, token hashing/rotation/expiry/use
limits, owner/customer authentication, same-origin writes, oversized bodies,
forged payment operations and checkout-closed behavior.

Concurrent Promise tests exercise application concurrency against PGlite, which
serializes its engine internally. Independent-connection PostgreSQL contention
testing is still needed before enabling payments.

## Mandatory next gates before enabling checkout

1. Configure real pricing/license policies; no products or prices are seeded.
2. Complete tax treatment/calculation, shipping and currency policy. The current
   quotes are explicitly **pre-tax digital-only previews** with zero tax/shipping,
   not a purchasable offer or determination that tax is not owed.
3. Implement and sandbox-test Stripe session creation with local order-ID
   idempotency and quote snapshots, not browser amounts or item JSON metadata.
4. Verify webhook raw-body signatures, Stripe account, test/live environment,
   event type, payment status and local session/amount/currency binding before
   calling `applyVerifiedPayment`. No HTTP endpoint exposes this domain method.
5. Apply and verify `0011_commerce_session_outcomes.sql`, then sandbox-test the
   implemented expired-session/async-failure adapter. Expired sessions may have
   no PaymentIntent: the separate session ledger preserves null without invented
   IDs. Only verified terminal outcomes release pending coupon reservations;
   local timeouts do not release a session that could still pay.
6. Add partial refunds, disputes, chargebacks and reconciliation. Current refund
   events require the complete order amount. Do not acknowledge unsupported
   events as successfully applied.
7. Add authenticated original streaming/short-lived download delivery and failure
   handling. Current download reservation consumes one attempt even if later
   object delivery fails. Buyer delivery must be tested against private R2.
8. Add manual-print proof-review/fulfillment/shipping state, crop preview and DPI
   checks. Print products are deliberately unavailable in quote generation.
9. Add price-list parent/folder inheritance if desired. Currently inheritance is
   explicit gallery-list override, otherwise the one global default. Missing
   override prices fail closed rather than silently changing the purchase price.
10. Extend editing/revocation/audit UI, pagination and order detail views as needed.

No production secrets, real charges, public-original permissions or custom-domain
settings are changed by these files. Installation in staging is not equivalent to
live provider acceptance.
