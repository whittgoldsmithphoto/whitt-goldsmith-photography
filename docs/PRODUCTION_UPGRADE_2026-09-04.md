# Existing production deployment upgrade

The owner explicitly selected upgrading `whitt-goldsmith-photography`, not creating a replacement production deployment. The SmugMug custom domain is unchanged.

## Recovery points

- Prior Worker version: `51e0831a-c272-4faa-a8d4-1a0570a30c2d` (source commit `d1b711f`, Read integration secrets from Cloudflare Worker env).
- Retained Neon data/schema branch: `pre-catalog-upgrade-2026-09-04`, ID `br-divine-sky-a52t2goq`, auto-delete Never.
- Production Neon project `soft-scene-90717120`; original production branch `br-twilight-term-a597tv8m` remains the active database.
- Hyperdrive `78c0c17c5ba844f4bb678dbbb1846311` still targets `ep-silent-smoke-a5vz1fik-pooler.us-east-2.aws.neon.tech/neondb`. Query caching was disabled to avoid stale payment/access state.

## Applied and verified

- Migrations 0005–0022 applied in one transaction with advisory lock and timeouts. All 22 root migrations recorded. Existing user/order/settings counts were zero before and after; no existing records deleted.
- Existing private-storage integration uses the `whitt-goldsmith-photos` bucket through `CATALOG_BUCKET`, plus the Images binding. Bucket inventory reports zero objects; no staging/customer photos copied or published.
- Production Worker version `5860dcc4-1940-4155-b4d3-3a7a641bb109` deployed to the same workers.dev address.
- 360 tests pass; typecheck passes; lint zero errors/six existing warnings; production build passes. Tests use a complete release snapshot, leaving unrelated working-tree deletions untouched.
- `/api/commerce?op=status`: HTTP 200, checkout unavailable and quote-only.
- Anonymous `/api/commerce?op=owner`: HTTP 401. `/api/auth/get-session`: HTTP 200, null session.
- POST `/api/commerce-webhook`: HTTP 503 while explicitly disabled. This is deployed routing evidence, not accepted Stripe delivery.

## Remaining connection steps

- A dedicated live Stripe key named `WGP Catalog Production` was created in live account `acct_1UBQ70D2rNLvqnsK`; it has not yet been copied into the Worker. Old Stripe keys were not rotated or deleted. The one-time confirmation dialog needs to be made visible in Dia to complete secure transfer.
- Store the key as encrypted `CATALOG_LIVE_STRIPE_SECRET_KEY`; configure `CATALOG_LIVE_STRIPE_ACCOUNT_ID` and verify account/mode via read-only provider calls.
- Create the live catalog webhook at `https://whitt-goldsmith-photography.whittgoldsmithmedia.workers.dev/api/commerce-webhook`, store its signing secret under `CATALOG_LIVE_STRIPE_WEBHOOK_SECRET`, verify required events, then enable webhook processing independently of checkout. Do not silently repoint the legacy destination.
- Create/sign into the first production owner account and bind its verified ID to `OWNER_USER_IDS`. Staging account records were deliberately not copied.
- Configure the actual production watermark, prices, photos, Stripe Tax classification/registration, receipt/policies, recovery credentials and delivery acceptance. All live checkout/download/webhook flags remain false.

Use `npm run verify:production` for explicit production configuration/build/test checks. `WGP_PRODUCTION_MIGRATIONS_VERIFIED=true npm run deploy:production` additionally deploys, retaining runtime secrets. The generic Cloudflare deployment command stays disabled, and staging commands remain staging-only. GitHub-connected build settings still need a deliberate production command update; this release was deployed through the explicit local production runner.

The Postgres guidance influenced the short, guarded migration transaction; external provider work happened outside it. No real charge or live purchase test was performed.
