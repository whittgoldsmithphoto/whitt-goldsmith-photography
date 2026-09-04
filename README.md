# Whitt Goldsmith Photography

Server-backed sports and event galleries with private originals and owner authorization.

Start with the [backend capability manifest](docs/BACKEND_CAPABILITY_MANIFEST.md) for implemented, gated, planned and rejected capabilities. The [remaining-work register](docs/BACKEND_REVISION_REMAINING.md) covers the backend revision and earlier A–D/security audits, including decisions and live acceptance still required. Historical checkpoint reports are not current activation guarantees.

## Public vs owner

Visitors can view permitted galleries without an account. Saving proof selections and notes currently requires an account. Guest checkout is not implemented; commerce remains disabled pending sandbox acceptance.

The owner door is `/login`; access requires the explicitly configured owner account, not merely being signed in. Legacy Settings, Keywords, Migrate, Publish and order tools are disabled. Use Organizer, Proofs and Selling for server-backed operations.

## Run locally

```
npm install
npm run dev
```

```
npm run build
npm run typecheck
```

## Publish on Cloudflare

Same account as R2. See [HOSTING.md](HOSTING.md).

```
npm run verify:staging
npm run deploy:staging
```

Do not use a bare Wrangler deployment: the staging release script validates generated bindings and targets the explicit staging Worker while preserving runtime secrets/settings. Production promotion and the SmugMug custom-domain cutover are separate actions.

Owner sessions and catalog orders sit in PostgreSQL behind Cloudflare Hyperdrive. Stripe integration status and its activation gates are documented in the manifest; configured signing secrets alone do not mean checkout works.

## Layout

- `src/routes` — public pages and owner tools
- `src/components` — wall, lightbox, organizer, cart
- `src/lib/catalog` — authoritative catalog, access, proofs and media operations
- `src/lib/catalog-commerce` — authoritative quote/order/payment/delivery boundaries
- `src/lib/sports` — approved sports metadata and search
- `src/lib/store.ts`, `src/lib/shop-fns.ts` — retained legacy/browser-local code, not the authoritative catalog
- `wrangler.jsonc` — Cloudflare Worker
- `public/photos` — unused sample files; live originals go to R2
