# Payment event recovery

The separate `src/payment-recovery-worker.ts` has no public HTTP control endpoint. Its staging config is `wrangler.recovery.jsonc`, with a five-minute Cron Trigger and recovery **disabled by default**. It never creates charges or trusts a browser's payment-success claim.

It discovers Stripe event IDs, persists them before advancing the discovery cursor, retrieves each event through the account's secret key and uses the same account/mode/session/amount/tax/charge verification and SQL ledger as signed webhooks. The recovery inbox contains only event IDs and sanitized status, not Stripe payloads or secrets.

A five-minute fenced lease limits overlapping discovery. Effects are deliberately at-least-once: a crash after settlement but before inbox acknowledgment replays against the idempotent payment ledger. Failed events retry every five minutes; ten failures move them to `review` without blocking discovery. Unknown orders and old-shop events must be reviewed, not force-bound to a new catalog order.

Each run fetches at most one 100-event page and attempts ten inbox events. The first run covers the preceding 24 hours; subsequent windows overlap at their inclusive boundary and lag wall time by two minutes. Historical gaps before the initial window need explicit review/backfill. A checkpoint older than 29 days stops with an error rather than silently skipping Stripe's 30-day event retention boundary. [Stripe event listing](https://docs.stripe.com/api/events/list), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Configuration

Apply migrations 0021 and 0022 before enabling. The recovery Worker must have the same environment/account, database binding, encrypted Stripe key and tax mode as its catalog Worker. Separate Workers do not inherit secrets. Recovery retrieves events directly from Stripe and does not require a webhook signing secret. The staging file names the already-isolated staging Hyperdrive and sandbox account; it must not be repurposed for production. New-sale switches are intentionally unnecessary: refunds and payment recovery must continue while new checkout is disabled.

Dry-run: `npx wrangler deploy --dry-run --config wrangler.recovery.jsonc`.

Deploy the separate staging Worker: `npx wrangler deploy --config wrangler.recovery.jsonc`. Provision `CATALOG_STRIPE_SECRET_KEY` directly in Cloudflare as an encrypted secret; do not print it. Enable `CATALOG_RECOVERY_ENABLED` only after account/binding validation. Never enable recovery before checking existing unprocessed sandbox orders: recovering a verified event can change their order/entitlement state.

Read-only operator checks:

```sql
SELECT id,window_start,window_end,cursor,lease_until,updated_at FROM commerce_recovery_streams;
SELECT status,count(*) FROM commerce_recovery_events GROUP BY status;
SELECT stream_id,event_id,attempts,last_error FROM commerce_recovery_events WHERE status='review';
```

## Boundaries still requiring work

This recovers existing Stripe events, including expiry events. It is not proactive expiry of still-open sessions after gallery access changes, recovery of an unbound session after an ambiguous create response, or a complete owner-facing dispute console. Access revocation still blocks download authorization. Those pending-session races need separate acceptance before launch. Successful dry-run/local tests do not prove actual scheduled execution or actual provider recovery.

## Deployment evidence — 2026-09-04

- Full release snapshot: 360 tests pass; typecheck passes; lint zero errors and six existing warnings. Storefront build and standalone Wrangler bundling pass.
- Staging catalog Worker version: `6224fae0-2073-4cdd-9bf4-33cbced62200`.
- Recovery Worker version: `dacd305e-529f-4301-a280-5cf541b01ed5`; five-minute schedule installed; `CATALOG_RECOVERY_ENABLED=false`.
- Neon WGP Catalog Staging, project `wispy-glitter-74783001`, branch `br-muddy-water-ay9lfztf`: migrations 0021/0022 committed transactionally. Readback: both migration records, four retained photos, one retained product, zero recovery inbox events.
- Deployed public commerce status returns `checkoutAvailable:false`, `quoteOnly:true`.
- Recovery Worker secret listing is empty. It needs the sandbox `CATALOG_STRIPE_SECRET_KEY` provisioned directly in Cloudflare before provider acceptance; no credential was copied into source or chat.
- No production charge, production database migration, or SmugMug domain change.
