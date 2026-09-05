# Cloudflare release instructions

Deploy from a clean checkout of the intended Git revision:

```sh
npm ci
npm run deploy:staging
```

This builds the Cloudflare Worker and browser assets together, runs tests/typecheck/lint, verifies staging resource bindings, deploys with `--keep-vars`, and checks the live `x-wgp-revision` header and application assets.

`npm run build` is the generic preview/Vercel build. It does **not** refresh `dist/server`, and must never be followed by bare `wrangler deploy`. That combination repeatedly deployed old Cloudflare files during September 5 updates. An HTTP 200 alone does not verify a new release.

Staging: https://wgp-catalog-staging.whittgoldsmithmedia.workers.dev

Owner login: `/login`. Organizer: `/organize`. Pricing and orders: `/sell`. Proof inbox: `/favorites`.

Staging uses its own Neon database through the existing Hyperdrive binding and its private `wgp-catalog-staging` R2 bucket. Keep original photos and keys out of Git. Configure secrets on this exact Worker; `--keep-vars` preserves provider settings between releases.

Apply missing migrations from `migrations/` in order to the matching database, transactionally recording each filename in `_migrations`. A successful application build is not a database migration. Verify schema, retained photo counts, and affected workflows afterward.

The catalog Stripe webhook is `/api/commerce-webhook`, not the retained legacy `/api/webhooks/stripe` route. Test and live accounts have separate keys, signing secrets and acceptance gates. Stripe Tax configuration, an actual paid session, webhook settlement, delivery and refund revocation must be verified before enabling live sales.

The SmugMug custom domain stays where it is until Whitt approves the cutover. Production has its own guarded release command and migration gate; staging approval is not domain-cutover approval.
