# Live Stripe readiness

Inspected the signed-in Stripe dashboard during this backend revision. This is a setup report, not payment activation.

- The live Whitt Goldsmith Photography account already exists: `acct_1UBQ70D2rNLvqnsK`. A live publishable key and a recorded payment are visible; this does not establish every compliance/payout requirement.
- Its existing `Cloudflare 1` webhook targets `https://whitt-goldsmith-photography.whittgoldsmithmedia.workers.dev/api/webhooks/stripe`.
- Three recorded delivery attempts for one `payment_intent.succeeded` event returned HTTP 400, `Invalid signature`. This proves verification failed; it does not alone distinguish mismatched signing secret, an overridden stored secret, or runtime verifier behavior.
- Source review shows that legacy handler reads `shop_settings` before Cloudflare `STRIPE_*` variables. Updating an environment variable alone may therefore leave the effective secret unchanged. It also writes the older `shop_orders` model, not the catalog commerce ledger.
- The new catalog endpoint `/api/commerce-webhook` is independently configured and deliberately sandbox-only. Live events must not be redirected there until a production adapter, separate live configuration, and acceptance gates exist.

No live API key or webhook signing secret was revealed or copied, endpoint edited, payment made/refunded/replayed, payout altered, or production charging enabled in this setup review. The existing failed deliveries were inspected only.

## Remaining live setup

1. Finish authenticated checkout/customer return pages, session cancellation/reconciliation, tax adapter, and customer delivery/history.
2. Approve real products/prices, license/refund rules, seller jurisdiction/tax treatment, receipt details, and download limits.
3. Prove sandbox checkout → signed event → exact order/entitlement → authorized R2 delivery → refund revocation, including replay and failure cases.
4. Implement production-only payment configuration with an explicit live account binding; keep live and staging secrets, database/order records, endpoint signing secrets and feature flags separate.
5. Before changing the old live endpoint, identify its existing consumers/orders, confirm which secret source is authoritative without logging it, and reconcile pending events. Do not repair signature verification merely to activate the obsolete order writer.
6. Create/verify the correct live catalog destination only after its deployed URL accepts and safely reconciles the required events. Store its signing secret directly in the matching production Worker, not chat or GitHub.
7. Confirm account verification/payout readiness with the owner and run an explicitly authorized live acceptance purchase only after the above gates.

The SmugMug custom domain remains unchanged. Live account setup is not blocked on domain cutover, but the new storefront is not yet ready to take real payments.
