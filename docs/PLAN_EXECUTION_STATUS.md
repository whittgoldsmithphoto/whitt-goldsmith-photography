# Photography platform execution status

September 3, 2026. Review branch: `audit/server-catalog`. Do not merge to production yet.

## Completed in code in this increment

- Migration `0007_proof_selections.sql`: account-owned proof lists, selections,
  notes, revisions and owner-review state. Indexed foreign keys follow the database
  skill's guidance; changes and audit recording use a short atomic SQL statement.
- Customer gallery favorites in the grid and lightbox; explicit Save selection;
  account sign-in/registration returning to the same gallery. Registration does
  not grant owner access or unlock a password gallery.
- The same customer can retrieve a selection on another device. A reference ID
  can be sent to Whitt but is **not** a bearer token or a public link to private notes.
- Owner `/favorites` is now a database-backed proof inbox, not browser-local
  favorites. It displays the latest 100 lists and marks a particular version
  reviewed. Later changes become unread. Email notifications, an older-list
  pagination/search workflow and full comment threads are not implemented.
- Saves validate gallery access and visible, ready photographs. Hidden/archived
  selections are filtered from customer reads; the owner can still see their
  historical membership. A stale save returns 409 and the UI retains the draft.
  Selections are limited to 500 photographs; notes to 2,000 characters.
- Owner-only diagnostics distinguish configuration presence from live verification:
  environment, actual database connection mode, storage mode, Images, watermark,
  migration status and check time. No credential values are returned.
- Native R2 `CATALOG_BUCKET` adapter supports conditional immutable originals,
  checksums, exact-byte retry acceptance and explicit failure. Production can retain
  its existing S3 credential adapter. With `CATALOG_ENV=staging`, an absent native
  binding fails closed rather than falling back to production S3 credentials.
- The old seed-priced Checkout server function now rejects all requests. `/cart`
  and `/checkout` show an honest unavailable state and cannot manufacture local
  orders. Existing Stripe credentials/webhooks were not changed. The former code
  remains in Git history; this is a safety hold, **not** Phase C completion.

## Local evidence and limits

`scripts/catalog-proof-browser-check.mjs` starts an isolated localhost:8092 server.
It uses the real application HTTP routes, Better Auth accounts/cookies and shared
PGlite database. The seed media processor/storage and browser image bytes are
explicit synthetic fixtures. No live provider credentials or photographs are used.

Verified by that harness:

- customer registration, second-device sign-in and selection persistence;
- owner inbox sees the same note and photographs, acknowledges the current
  revision, and sees a later change as unread;
- stale device save fails while retaining its unsaved note;
- anonymous proof/diagnostic denial, non-owner inbox denial, cross-origin mutation
  denial, and anonymous original denial;
- disabled checkout page, owner diagnostics and applied local migrations;
- 375px, 768px and 1440px gallery/inbox layouts, lightbox favorite and Escape;
- auth dev/build invariant with sign-in enabled on the harness server.

The standalone default `npm run check:auth` initially could not observe port 8080.
The harness reruns that same checker with its explicit localhost:8092 origin and
auth-enabled environment. Do not misreport an absent default server as a successful
check. The new owner photo editor still needs its own browser acceptance test.

The working folder retains unrelated missing tracked PWA/portfolio assets and a
missing `scripts/grok-pwa-shared.d.mts`. Those deletions are excluded from this
commit. Full validation uses an isolated archive of HEAD plus this authored patch.
This preserves the user's worktree and does not conceal its current typecheck and
missing-icon test failures.

## Cloudflare work verified during this increment

- Production Worker still serves the older `Read integration secrets from
  Cloudflare Worker env` deployment on `main`; new code is live only on staging.
- Existing `whitt-goldsmith-photos` bucket was empty and public access disabled.
- Created separate **`wgp-catalog-staging`** bucket in the existing account:
  Standard storage, automatic Eastern North America location, empty and public
  access disabled. First dashboard request failed; after refresh, the retry
  succeeded and the new bucket's detail page verified it. No objects uploaded.
- No custom domain, production migration, production binding, paid plan, Stripe
  configuration or real-photo publication was changed.

## Immediate staging continuation

After the user signed in and approved a separate database, created **WGP Catalog
Staging** in the existing Neon Free organization, AWS Ohio, Postgres 18, Neon Auth
off. Project: `wispy-glitter-74783001`; default branch: `br-muddy-water-ay9lfztf`
(named `production` by Neon, but inside this separate staging project); database:
`neondb`. Verified zero public tables before applying repository migrations
0001–0007 in a transaction. A subsequent read-only query verified **7 migration
records, 17 public tables, 0 photos and 0 proof lists**. The original database was
not modified. Neon generated credentials, subsequently transferred with approval. This
new database now has its own Cloudflare Hyperdrive connection:
`wgp-catalog-staging-db`, ID `c9d803e0e964401298a952b85dd05af4`.
After explicit user approval, its existing credentials were transferred directly
from Neon to Cloudflare, not saved in chat or repository files. Cloudflare saved
the configuration successfully; its settings verify the staging endpoint and
disabled query caching. The deployed Worker returned 200 with an empty public
catalog from the database. Anonymous owner, diagnostics and proof inbox requests
each returned 401; auth get-session returned 200/null. Authenticated upload,
derivative processing and commerce remain unverified.

The `staging` environment in `wrangler.jsonc` targets this Hyperdrive connection,
the separate private bucket and an Images binding. Build with
`CLOUDFLARE_ENV=staging VITE_AUTH_ENABLED=true npm run build:cloudflare` and inspect
the generated `dist/server/wrangler.json` before deployment, then run
`npm run check:staging`. The staging-only guard and its two tests pass.

Deployed `wgp-catalog-staging` at
https://wgp-catalog-staging.whittgoldsmithmedia.workers.dev with version
`71444499-252d-443c-8b6c-ddbcb384754a`. Unique runtime auth secret and actual auth
URL are configured. Owner allowlist and watermark key are now configured. User account
creation is prepared at `/login?setup=1`; email/password is the configured path,
not the currently visible but unconfigured Google/X options.

Wrangler's combination of `--name` and `--env` initially created an accidental
empty `wgp-catalog-staging-staging` Worker. It was deleted successfully; no user
data was stored there. The correct Worker received a separately generated secret
using the generated config. Do not combine name and environment for secret setup.

The supplied SVG logo was rasterized to a transparent PNG without changing its
design and stored privately at `branding/watermark.png`. Public test-gallery
publication is still pending; keep the approved private test photographs private.

After that:

1. Separate empty test database and migrations 0001–0007 are complete. No
   customer/production records were cloned.
2. Separate staging Worker deployed from the authored working tree. This source
   is maintained on the review branch; main is unchanged.
3. Staging R2, Images, Hyperdrive, environment and auth URL/secret configured.
   Provider bindings are not equivalent to tested photo processing.
4. Owner account and exact `OWNER_USER_IDS` are configured and the signed-in
   Organizer was verified live. `CATALOG_WATERMARK_KEY` points to the supplied logo.
5. Verify real original checksums, ready JPEG/PNG derivatives, watermark pixels,
   stripped GPS, retry behavior and representative Worker resource usage.
6. Test public/private/password galleries and proof persistence with fresh
   customer/owner sessions on staging. No public original access is acceptable.

### Real private photo acceptance — 2026-09-03

- Uploaded three user-approved football JPEGs through the signed-in Organizer:
  SWG01452.jpg (6,826,940 bytes), SWG01538.jpg (2,310,885 bytes), and
  SWG03038.jpg (10,242,855 bytes). All three returned `ready`, with zero awaiting
  processing. The gallery remains a private draft.
- All three displayed SHA-256 values match the corresponding local originals.
  An independent R2 download of SWG01452.jpg also matched its local SHA-256.
  The live processing path verifies original and derivative R2 readbacks before
  marking a photo ready. Watermarked thumbnails were visually observed.
- Signed-out original request returned 401; private preview returned 404; public
  index contained no galleries, photos, or folders. No originals were added to Git.
- This verifies the JPEG sample only, not RAW/TIFF, all 131 photos, GPS stripping,
  interrupted-upload recovery, public proofing, load limits, or commerce.
  Stripe and the existing SmugMug custom domain remain untouched.

Relevant provider contracts:
[R2 binding and conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[Images binding](https://developers.cloudflare.com/images/optimization/binding/),
[Images pricing](https://developers.cloudflare.com/images/pricing/).

## What is not finished

### Owner setup and Worker connection repair

The user's email/password registration succeeded. Its verified account ID was
configured as the staging-only `OWNER_USER_IDS` runtime secret. No password was
read. Owner reads then revealed a real Workers runtime cancellation: the isolate
was retaining a PostgreSQL pool across requests. Catalog queries now create and
close request-local clients; auth instances/pools are no longer cached across
Worker requests. Hyperdrive retains upstream pooling. This follows
[Cloudflare's connection lifecycle guidance](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/).
Staging build, config guard and all 11 catalog tests passed. Deployed repair:
`88e493b9-28e6-4d7a-b788-3536ba580d18`. This does not complete live photo acceptance.

| Phase | Outstanding acceptance/work |
| --- | --- |
| A | Live owner-to-public upload path; real Images/R2 verification; RAW/TIFF development; large multipart/resumable ingestion; durable batch queue; folder moves; explicit legacy-data import; pagination, retention and recovery checks. |
| B | Live proof acceptance; inbox pagination/search and richer comments; gallery-specific instructions/policy; entitlement-backed single/whole-gallery downloads and buy actions. No download is granted by selecting a favorite. |
| C | Database prices/products/inheritance; authoritative quotes; crop/DPI/shipping/tax rules; coupon accounting; local orders; verified Stripe sandbox payment/replay/refund; hashed expiring entitlements; manual print fulfillment; accurate customer order pages. Stripe remains paused per the user's earlier instruction. |
| D | Approved sports metadata/search; Lightroom/watched-folder publishing; reviewed and reversible AI suggestions; provenance/export protection; QR event access; selected-image sharing and licensing inquiries. These follow core acceptance and need provider/workflow choices. |

This is ongoing implementation, not a completed roadmap, production launch, or
proof that live payment/storage services work.
