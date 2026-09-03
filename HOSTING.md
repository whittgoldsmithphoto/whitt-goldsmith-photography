# Host on Cloudflare

The studio, originals, DNS, and CDN all live in your Cloudflare account. Stripe still takes the card. A small Postgres (Neon, behind Cloudflare Hyperdrive) holds owner sessions and orders — Workers cannot keep those in R2.

Public site: galleries and guest checkout. Owner door: `/login` (first time `/login?setup=1`).

## One-time map

| Piece             | Cloudflare                             |
| ----------------- | -------------------------------------- |
| This app          | Workers (this repo)                    |
| Photographs       | R2 — already connected in Settings     |
| Domain            | Same zone as R2                        |
| Sessions / orders | Hyperdrive → Neon Postgres             |
| Payments          | Stripe Tax (webhook on the Worker URL) |

I keep editing here. You publish from GitHub → Cloudflare. I am not in the live path.

## 1. GitHub

Create a repo and push this folder.

## 2. Neon (sessions and orders)

1. Create a Neon project (free tier is enough).
2. Copy the pooled connection string.
3. In Cloudflare: **Storage & databases → Hyperdrive → Create**. Point it at that Neon URL. Copy the Hyperdrive connection string — that is `DATABASE_URL` on the Worker.

Then bind that Hyperdrive configuration to this Worker in `wrangler.jsonc`:

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<your-hyperdrive-id>" }]
```

The repository currently has a placeholder comment for this account-specific ID. Do not deploy until the real ID is present and the Worker can reach the database.

Apply schema once from a machine that can reach Neon:

```
DATABASE_URL="postgresql://…" npm run db:migrate
```

## 3. Cloudflare Worker

**Dashboard (easiest)**

1. [Workers & Pages](https://dash.cloudflare.com/) → **Create** → **Workers** → **Connect to Git**.
2. Select the repo.
3. Build command: `npm run build:cloudflare`
4. Deploy command: `npx wrangler deploy --config dist/server/wrangler.json`
5. After the first deploy, **Settings → Variables and Secrets**:

| Name                 | Value                             |
| -------------------- | --------------------------------- |
| `VITE_AUTH_ENABLED`  | `true` (already in wrangler vars) |
| `BETTER_AUTH_URL`    | `https://your-domain`             |
| `BETTER_AUTH_SECRET` | long random string                |
| `DATABASE_URL`       | Hyperdrive connection string      |

R2 and Stripe can stay in the in-app Settings screen after you sign in. Or set them here too:

```
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

**CLI (same account as R2)**

```
npx wrangler login
npm run deploy:cloudflare
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put DATABASE_URL
```

You get a `*.workers.dev` URL immediately.

## 4. Domain

In the Worker: **Settings → Domains & Routes → Add** → your studio domain (the zone that already holds R2). Cloudflare will serve the site on that host. Keep SmugMug on the old URL until you are ready to cut DNS.

Stripe webhook: `https://your-domain/api/webhooks/stripe`

## 5. First owner login

1. Open `https://your-domain/login?setup=1`
2. Create the one owner account
3. Bookmark `/login`
4. Settings → paste R2 (if not already in secrets) and Stripe
5. Stripe Tax: add this domain in the Stripe Tax dashboard

## After it is live

Create folders in Organizer, drop zips on Upload. Public galleries and checkout stay on the front. Owner tools stay behind the footer mark.
