# Whitt Goldsmith Photography

Public galleries, guest checkout, prints. Owner tools stay behind an unlisted door.

## Public vs owner

Visitors see galleries, photographs, cart, and checkout. They do not create accounts.

The owner door is `/login` (first time `/login?setup=1`). It is not in the public menu. A small mark in the footer is the quiet link. After you sign in: Organizer, Upload, Library, Selling, Settings, Migrate.

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
npm run build:cloudflare
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
