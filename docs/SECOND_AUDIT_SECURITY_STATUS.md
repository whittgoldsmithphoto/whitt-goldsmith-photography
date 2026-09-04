# Second audit security checkpoint

September 3, 2026 EDT / September 4 UTC. Source reviewed: `GROK_SECOND_AUDIT_SERVER_CATALOG.md`, covering `fe1c542`. This is a security increment, not completion of the whole audit or payment acceptance.

## Fixed and verified

- Explicit staging build/verify/deploy commands. The ambiguous deploy alias fails with instructions. Generated bindings are checked before deployment. Deployment explicitly supplies `--name wgp-catalog-staging --env ''` and preserves saved runtime variables with `--keep-vars`. Production promotion is intentionally unavailable from this branch.
- Testing caught Wrangler reinterpreting a resolved staging config and appending another `-staging`. Environment isolation plus the explicit name/empty environment fix this. The accidental duplicate Worker was removed; shared R2 objects and the database were not removed. The correct final deployment is `06ea91ce-da30-4dcd-b23a-af5fafab199e`.
- Owner navigation now requires a server-verified owner capability and resets across account changes. Customer sign-in alone does not grant it. Disabled commerce does not advertise Cart. Duplicate mobile Settings entry removed.
- Legacy Settings/Keywords/Migrate/Publish/order pages no longer mount their legacy mutation controls, including the misleading local catalog deletion. Old source/local state is preserved, not silently deleted. Server-backed branding settings remain to be built.
- The obsolete TypeScript reservation method now fails closed for every call. Migration 0014 drops the weaker SQL function without deleting entitlement data.
- Migration 0015 adds atomic per-gallery/client password buckets before a 1000-attempt/minute shared backstop. Client keys are secret-salted hashes of Cloudflare's connecting IP and gallery, never raw addresses. Repeated attempts have capped backoff. A regression test confirms a throttled client does not lock out a clean client. Retention cleanup and distributed-abuse monitoring remain.
- Same-origin API fetch forwards preview bearer credentials for catalog, upload, owner sports metadata, pricing, and integrity requests. The helper refuses external URLs; cookie authentication remains supported. Public sports search does not require a bearer.
- Successful password unlock reloads proof state. The real local browser test now exercises signed-in customer -> password -> unlock -> usable proof panel without a page refresh.
- Automatic test discovery includes every script/TypeScript test file. Latest full run: **316 tests passed**, typecheck passed, lint zero errors/six baseline warnings, staging build/target guard passed. The final explicit-name deployment argument assertion also passes separately.
- Local browser harness passed real HTTP/auth/PGlite proof, owner capability, disabled legacy controls, pricing/coupon preview, and mobile/tablet/desktop checks. Media/provider behavior in this harness remains simulated.
- Live staging HTML verified CSP base-uri/object-src/frame-ancestors/form-action, Permissions-Policy, Referrer-Policy and nosniff headers. This is a baseline CSP, **not** a complete nonce-based script policy. Development permits the existing preview iframe.
- All installed Undici copies now resolve to **7.29.0**. This includes the formerly vulnerable Nitro/env-runner/Miniflare path. Official patched-version reference: https://github.com/nodejs/undici/security/advisories/GHSA-jr45-8vmc-qm54 . Full npm audit attempts timed out/returned service errors; a clean whole-tree advisory result is not claimed.
- GitHub Actions added for automatic discovery/tests, typecheck, lint, staging build guard, local browser acceptance and high-severity dependency audit. Main now requires the `verify` check on an up-to-date branch, including administrators; force pushes and deletion are disallowed. Remote run results must still be inspected. Dedicated full-history secret scanning remains to be added; a local changed-source credential-pattern scan found no matches.

## Staging/database evidence

Guarded transaction applied 0014/0015 only to Neon project **WGP Catalog Staging**, using the known private photograph and 0013 baseline as sentinels. Neon reported DROP, CREATE, INSERT 2, COMMIT and SELECT 15 successfully. No photographs were published or deleted.

Final anonymous checks: capabilities `{isOwner:false,checkoutAvailable:false}`; unsigned webhook **400 Invalid webhook signature**; customer delivery **503 disabled pending sandbox acceptance**. Existing Stripe variables/secrets survived the corrected deployment.

## Payment testing boundary

The prior real Stripe sandbox event `evt_1UBmTtDHsmsdTdegJolrP082` passed signature/account checks and returned **409 Checkout Session has no bound local order**. This is a negative test, not successful order fulfillment. The trigger created Stripe sample test resources; no real money was charged. Local tests exercise paid/replay/full-refund/revocation and protected delivery with provider fixtures. Checkout Session creation tied to a website order, usable customer order/download UI, and a real payment -> entitlement -> R2 download -> refund acceptance remain incomplete. Live checkout remains off.

## Still open from the audit

Public pagination/cover-only index, explicit covers and alt text, a revocation-safe derivative cache design, bundle performance measurement, server-backed studio settings, ZIP/folder/drop ingestion, broader public/password/revocation acceptance, full CSP, complete dependency-advisory confirmation, and dedicated secret scanning. Keep the private sample gallery private; publication of a separate real portfolio collection needs intentional image selection. Do not interpret the attached audit's publication suggestion as authorization to expose the private samples.

The review requested consolidation before new feature waves. This checkpoint follows that priority: checkout creation and print features are not represented as shipped. Previous acceptance notes describe historical results and should be read alongside this checkpoint.
