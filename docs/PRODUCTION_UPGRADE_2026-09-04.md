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
- Initial POST `/api/commerce-webhook` returned HTTP 503 while disabled. After live connection, unsigned requests return HTTP 400 (invalid signature), and a locally signed unsupported diagnostic event returns HTTP 422 without changing order state. This verifies signature handling, not a real Stripe delivery or purchase.

## Live Stripe connection verified September 4

- Dedicated live key securely stored as `CATALOG_LIVE_STRIPE_SECRET_KEY`; account verified through the Stripe API as `acct_1UBQ70D2rNLvqnsK`, with charges and payouts enabled. Legacy keys remain untouched.
- Live webhook `we_1UBv9SD2rNLvqnsKYWcbccYp` targets `https://whitt-goldsmith-photography.whittgoldsmithmedia.workers.dev/api/commerce-webhook`. Subscriptions: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`.
- Its signing secret is encrypted as `CATALOG_LIVE_STRIPE_WEBHOOK_SECRET`; account ID and digital tax code are also stored. No credentials are committed. Existing webhook destinations remain unchanged.
- Active connection deployment: `69b54cb2-399c-416c-b878-33801aa702eb`. Webhook enabled independently; customer checkout and downloads remain disabled. Public commerce status still reports quote-only.
- Stripe Tax settings report active, provider Stripe, default code `txcd_10505000`. The active-registration list is empty: South Carolina registration is NOT verified or configured. Tax classification still requires owner confirmation.
- Cloudflare secret updates initially failed with error 10215 because the latest uploaded Worker version was not deployed. Redeploying the known verified production bundle resolved this; all four live bindings were then successfully saved.

## Remaining connection steps

- Verify a real Stripe-delivered event and complete end-to-end checkout, payment-ledger and delivery acceptance. The signed diagnostic is not a substitute for these checks.
- Create/sign into the first production owner account and bind its verified ID to `OWNER_USER_IDS`. Staging account records were deliberately not copied.
- Configure the actual production watermark, prices, photos, Stripe Tax classification/registration, receipt/policies, recovery credentials and delivery acceptance. Checkout/download flags remain false; webhook processing is enabled.

Use `npm run verify:production` for explicit production configuration/build/test checks. `WGP_PRODUCTION_MIGRATIONS_VERIFIED=true npm run deploy:production` additionally deploys, retaining runtime secrets. The generic Cloudflare deployment command stays disabled, and staging commands remain staging-only. GitHub-connected build settings still need a deliberate production command update; this release was deployed through the explicit local production runner.

Production source deliberately omits the webhook gate from build-time variables. The guarded deployment preserves its runtime value with `--keep-vars`, so deploying with sales disabled does not also stop refund and delayed-event processing. Missing runtime configuration still fails closed.

The Postgres guidance influenced the short, guarded migration transaction; external provider work happened outside it. No real charge or live purchase test was performed.
