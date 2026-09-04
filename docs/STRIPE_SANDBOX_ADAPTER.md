# Isolated Stripe sandbox webhook adapter

**Status: implemented and locally tested; disabled and not provider-verified.**
No Stripe dashboard settings, credentials, live payments or existing webhook
configuration were changed. Customer checkout remains disabled.

## Endpoint and activation boundary

The new endpoint is `/api/commerce-webhook`, independent of the legacy
`/api/webhooks/stripe` route and old `shop_orders` tables.

It returns **503 by default**. Every isolated setting below is required:

- `CATALOG_ENV=staging`
- `CATALOG_STRIPE_WEBHOOK_ENABLED=true`
- `CATALOG_STRIPE_SECRET_KEY`: a dedicated **test-mode** secret key
- `CATALOG_STRIPE_WEBHOOK_SECRET`: the signing secret for this exact endpoint
- `CATALOG_STRIPE_ACCOUNT_ID`: expected direct Stripe account ID

Production environment or a live-mode secret key keeps this endpoint disabled.
Do not set these flags merely because unit tests pass; finish sandbox acceptance
and the missing event paths first. No legacy Stripe secret is reused implicitly.

## Implemented event paths

- `checkout.session.completed`: paid sessions apply payment; unpaid delayed
  sessions remain pending without granting an entitlement.
- `checkout.session.async_payment_succeeded`: requires a reread, paid session.
- `charge.refunded`: requires a reread, confirmed **full** refund matching the
  bound payment, local amount/currency and verified Checkout Session.
- `checkout.session.expired`: requires a reread expired, unpaid session. A null
  PaymentIntent is valid here and is saved as null, not a fabricated payment ID.
- `checkout.session.async_payment_failed`: requires a reread complete, unpaid
  session and matching test PaymentIntent with zero received funds and status
  `requires_payment_method` or `canceled`. Processing or paid intents fail closed.

Expiration and asynchronous failure require **migration
`0011_commerce_session_outcomes.sql`**. Its separate event ledger and atomic
pending-to-failed transition release coupon reservations exactly once. Paid and
refunded orders never downgrade. Missing migration produces a failure response,
not a successful acknowledgment. Migration presence and real provider behavior
must still be verified in the target environment.

The adapter verifies the **exact raw body** using Stripe SDK
`constructEventAsync`, WebCrypto and a 300-second timestamp tolerance. An
additional check rejects far-future signature timestamps (the SDK checks age).
It rejects live events, Connect/organization events, an incorrect provider
account, unbound local orders, inconsistent identifiers and payment values.

Retrieved Checkout Sessions must match:

- test mode, payment mode, complete state and appropriate payment status;
- local bound session ID, total cents and USD currency;
- `client_reference_id = local order ID`;
- metadata `wgp_order_id`, `wgp_quote_id`, `wgp_environment=staging`;
- the local payment intent binding when one already exists.

Before paid application, the adapter also retrieves the PaymentIntent and its
expanded latest charge. It requires succeeded state, matching amount received,
currency, full capture, no refund (including partial refund), and no dispute.
A delayed first paid event therefore cannot grant access after a known refund.

Payment application uses the atomic SQL ledger from the commerce foundation.
Duplicate signed deliveries do not issue duplicate entitlements. A full refund
revokes existing entitlements. Provider or database failures return a non-2xx
response so the event is not falsely acknowledged.

## Explicitly unsupported

Partial refunds, disputes, Connect, organization destinations, production mode
and checkout creation remain
unsupported. Such events return **422**, not a fabricated successful result.
Pending coupon reservations remain reserved until a verified terminal transition
is applied; a local timer alone never releases a potentially payable session.

Further acceptance must include actual out-of-order provider deliveries, handling
the still-pending local order when a first paid event finds an already-refunded
charge, restricted-key permissions and actual Stripe sandbox deliveries. The
fail-closed reconciliation checks prevent grants but do not automatically close
every unsupported financial state.

## Tests and evidence boundary

```
node --experimental-strip-types --test src/lib/catalog-commerce/stripe-adapter.test.ts src/lib/catalog-commerce/session-outcomes.test.ts
```

Fourteen tests combine real HMAC signatures, the real Stripe SDK verifier and
PGlite/PostgreSQL state transitions. Provider
reads are injected fixtures—**no Stripe API call is made**. One test applies paid
replay and full-refund events through the actual PGlite/PostgreSQL commerce state
machine and checks entitlement revocation; it also proves paid-after-refund
readback produces zero entitlements. HTTP tests prove default closure,
live/legacy setting rejection, missing signatures and body-size limits.
Terminal-outcome tests verify null-intent expiration, async failure, coupon reuse,
event replay/conflicts, paid/refunded non-regression and missing-migration failure.

## Official references

- [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature)
- [Stripe Checkout fulfillment and delayed payments](https://docs.stripe.com/checkout/fulfillment)
- [Stripe Node asynchronous raw-body webhook example](https://github.com/stripe/stripe-node/blob/master/examples/webhook-signing/deno/main.ts)
- [Stripe Charge object and refund amounts](https://docs.stripe.com/api/charges/object)
- [Stripe PaymentIntent amount received and latest charge](https://docs.stripe.com/api/payment_intents/object)
- [Stripe Checkout Session state and payment status](https://docs.stripe.com/api/checkout/sessions/object)
