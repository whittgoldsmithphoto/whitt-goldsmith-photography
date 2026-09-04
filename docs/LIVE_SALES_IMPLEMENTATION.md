# Live sales implementation — 2026-09-04

This source revision builds the digital-photo live payment path. It does **not** activate real charges or replace the old production Worker. Older readiness documents describe earlier deployment snapshots.

## Implemented

- Customer photo checkout reads saved owner prices/licenses and uses a server-created quote; browser totals are not accepted. Coupons use the existing server ledger.
- Separate production secret/account configuration and live event mode verification; test credentials and test switches cannot authorize live sales.
- Stripe Checkout automatic tax, exclusive of saved base prices. Provider preflight requires active tax settings, the configured digital tax code, and active US South Carolina registrations only, matching the owner's stated registration scope. It does not determine the owner's tax obligations.
- Signed payment verification checks session, account, currency, immutable base price, calculated tax, PaymentIntent and charge before fulfillment.
- Migration 0021 commits tax totals and payment/entitlement state atomically. Replay does not issue a second entitlement; conflicting totals fail; refunds revoke access through the existing review ledger.
- Live downloads have independent explicit release/delivery gates. New checkout requires downloads and webhook processing enabled. Turning off new checkout does not turn off webhook processing.
- Cancellation checks account identity independently of new-sale provider tax/payout readiness.

## Production configuration (all live switches stay false until accepted)

Use a separate production catalog Worker/database/private R2/auth configuration, not the obsolete shop ledger. Keep the SmugMug domain unchanged.

Encrypted secrets: `CATALOG_LIVE_STRIPE_SECRET_KEY` (live key), `CATALOG_LIVE_STRIPE_WEBHOOK_SECRET` (the new destination's signing secret).

Non-secret settings: `CATALOG_ENV=production`, `CATALOG_LIVE_STRIPE_ACCOUNT_ID`, exact HTTPS `BETTER_AUTH_URL`, and `CATALOG_STRIPE_DIGITAL_TAX_CODE` (verified actual Stripe classification; do not copy fixture values).

Explicit flags: `CATALOG_LIVE_RELEASE_ACCEPTED`, `CATALOG_LIVE_TAX_ACCEPTED`, `CATALOG_LIVE_DELIVERY_ACCEPTED`, `CATALOG_LIVE_WEBHOOK_ENABLED`, `CATALOG_LIVE_DOWNLOADS_ENABLED`, `CATALOG_LIVE_CHECKOUT_ENABLED`.

The new destination is the verified production catalog origin plus `/api/commerce-webhook`, not `/api/webhooks/stripe`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`. Never redirect unrelated old-order events into the new ledger.

## Still blocks launch

Validation: the release snapshot passes 357 tests, TypeScript checking, staging build and lint (zero errors, six pre-existing warnings). It restores HEAD-tracked files only inside a temporary verification snapshot; unrelated user deletions in the working tree are untouched. Focused tests include live/test credential gates, saved-price offers, signed tax arithmetic, transactional rollback, replay and refund revocation. No new live browser/provider acceptance is claimed.

1. Apply migration 0021 to isolated staging, deploy this revision, then exercise the new tax-enabled path with actual Stripe sandbox/R2 and browser evidence. Local simulated events are not provider acceptance.
2. Complete missed-webhook scheduled reconciliation, abandoned/expired session recovery and revocation races. Existing signed-event processing and explicit cancellation are not a scheduler.
3. Verify real tax registration/classification, receipt configuration, production keys/signing destination, owner authentication, private storage and database isolation on the actual production catalog target. Do not copy staging acceptance flags as proof.
4. Finish successful 3DS, real replay counts, tax-inclusive payment/refund and recovery acceptance. Confirm payout destination and owner-controlled price/license/refund policy before activation. An explicitly authorized live acceptance purchase remains separate from sandbox tests.
5. Gallery/album archive downloads and physical prints still have draft pricing only. Archive delivery needs packaging/entitlements; prints need a selected provider, shipping and fulfillment integration. These products remain unsellable rather than accepting undeliverable orders.

No custom-domain cutover, real charge, provider setting change or production migration was performed by this source revision. Existing Git history and unrelated local deletions remain preserved.
