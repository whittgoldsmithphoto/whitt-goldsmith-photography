# Whitt Goldsmith Photography

Server-backed sports and event galleries with private originals and owner authorization. Checkout and prints are not available yet.

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
npx wrangler deploy
```

Stripe still takes payment. Owner sessions and orders sit in Postgres behind Cloudflare Hyperdrive.

## Layout

- `src/routes` — public pages and owner tools
- `src/components` — wall, lightbox, organizer, cart
- `src/lib/store.ts` — catalog
- `src/lib/shop-fns.ts` — R2, Stripe, SmugMug
- `wrangler.jsonc` — Cloudflare Worker
- `public/photos` — unused sample files; live originals go to R2
