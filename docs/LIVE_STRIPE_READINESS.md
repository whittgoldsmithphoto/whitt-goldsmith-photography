# Live Stripe readiness

## Latest actual-provider acceptance

Follow-up account inspection: live account `acct_1UBQ70D2rNLvqnsK` Account status shows Payments and Payouts Active and "No active tasks to complete". Account details separately asks for phone verification to process payments from the Dashboard; this is not evidence that API payments are disabled. No account information, payout destination or tax setting was changed. Owner confirmation of real pricing/license/refund terms and tax registrations remains necessary.

The deployed sandbox checkout → signed webhook → paid order → byte-identical private R2 download → full refund → server-denied download sequence passed on 2026-09-04 UTC. See [provider evidence and remaining cases](STRIPE_PROVIDER_ACCEPTANCE_2026-09-04.md). All five temporary acceptance switches have been returned to false. Real payment processing remains disabled; tax, production configuration and the remaining failure cases are not yet accepted.

## Earlier implementation and deployment snapshot (before provider acceptance)

- Source `38865c2` pushed to `backend/resource-foundation`; earlier branches remain intact.
- 351 tests pass, typecheck passes, lint has zero errors and six existing warnings. All three local browser suites pass, including customer history, payment-status polling, synthetic original delivery and refund revocation. These are not actual Stripe/R2 purchase acceptance.
- Staging Worker version `804ec409-8179-45c6-910b-702624df5d8a` deployed successfully. `/purchases` renders; anonymous history is denied; public checkout remains unavailable.
- Migrations 0017–0019 applied transactionally only to WGP Catalog Staging. Readback: three retained photographs, zero published galleries, all three new migrations recorded.
- Owner saved the added `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed` subscriptions. Live dashboard readback confirms destination `we_1UBmMQDHsmsdTdegkwrmrf59` is Active and listening to eight events at the unchanged staging URL.
- Inspected the named sandbox destination's existing `checkout.session.completed` delivery: HTTP 409, `Checkout Session has no bound local order`. This passes signature/account/provider verification far enough to reach local order binding; it is not a signature failure and does not prove a successful website purchase. Do not replay an unrelated fixture to force fulfillment.
- Cloudflare readback confirms staging account ID, encrypted Stripe secrets, and webhook-enabled flag remain present. Owner-only checkout test flags are not yet configured. New acceptance must create its order through the website first, using clearly labeled non-customer test media; real photographs remain unpublished.
- Two sandbox destinations appear to point to the same staging URL. Do not remove either without inspecting its identity/signing-secret use and confirming removal. The named destination has three failed deliveries; an earlier signed unbound fixture is not a real successful checkout.
- No real charge, refund, live key change or live activation occurred. Live business/tax decisions, production adapter/configuration, scheduled reconciliation and real provider acceptance remain outstanding.

Inspected the signed-in Stripe dashboard during this backend revision. This is a setup report, not payment activation.

- The live Whitt Goldsmith Photography account already exists: `acct_1UBQ70D2rNLvqnsK`. A live publishable key and a recorded payment are visible; this does not establish every compliance/payout requirement.
- Its existing `Cloudflare 1` webhook targets `https://whitt-goldsmith-photography.whittgoldsmithmedia.workers.dev/api/webhooks/stripe`.
- Three recorded delivery attempts for one `payment_intent.succeeded` event returned HTTP 400, `Invalid signature`. This proves verification failed; it does not alone distinguish mismatched signing secret, an overridden stored secret, or runtime verifier behavior.
- Source review shows that legacy handler reads `shop_settings` before Cloudflare `STRIPE_*` variables. Updating an environment variable alone may therefore leave the effective secret unchanged. It also writes the older `shop_orders` model, not the catalog commerce ledger.
- The new catalog endpoint `/api/commerce-webhook` is independently configured and deliberately sandbox-only. Live events must not be redirected there until a production adapter, separate live configuration, and acceptance gates exist.
- Live Stripe Tax settings show a South Carolina head office, a digital-art/limited-rights preset, USD, and tax-exclusive pricing. These are observed settings, not a determination of tax liability. Registration status and suitability of the product classification remain unverified.

No live API key or webhook signing secret was revealed or copied, endpoint edited, payment made/refunded/replayed, payout altered, or production charging enabled in this setup review. The existing failed deliveries were inspected only.

## Remaining live setup

1. Deploy and accept the implemented owner-only sandbox checkout/cancellation route, immutable session-attempt lifecycle, rate limiting, and customer history/return/download pages. They remain off by default and sandbox-only; local browser acceptance passed with synthetic provider events/R2 bytes, not a real Stripe checkout.
2. Approve real products/prices, license/refund rules, seller jurisdiction/tax treatment, receipt details, and download limits.
3. Prove sandbox checkout → signed event → exact order/entitlement → authorized R2 delivery → refund revocation, including replay and failure cases.
4. Implement production-only payment configuration with an explicit live account binding; keep live and staging secrets, database/order records, endpoint signing secrets and feature flags separate.
5. Before changing the old live endpoint, identify its existing consumers/orders, confirm which secret source is authoritative without logging it, and reconcile pending events. Do not repair signature verification merely to activate the obsolete order writer.
6. Create/verify the correct live catalog destination only after its deployed URL accepts and safely reconciles the required events. Store its signing secret directly in the matching production Worker, not chat or GitHub.
7. Confirm account verification/payout readiness with the owner and run an explicitly authorized live acceptance purchase only after the above gates.
8. Finish scheduled reconciliation/automatic session expiry after access changes, partial-refund allocation and dispute-resolution workflows. Current adverse events conservatively hold/revoke delivery rather than claim a complete dispute-management product.

The new implementation is detailed in [checkout acceptance](CHECKOUT_SERVICE_ACCEPTANCE.md). Real tax calculation is still missing despite the existing dashboard preset. Verify registrations and treatment with the owner before enabling any real charge; the sandbox zero-tax fixture is never a live tax policy.

The SmugMug custom domain remains unchanged. Live account setup is not blocked on domain cutover, but the new storefront is not yet ready to take real payments.
