# Response to the Grok audit — shared catalog foundation

September 3, 2026. Branch: `audit/server-catalog`.

## Assessment and scope

The audit correctly identifies browser-local authoritative data, client-side gallery passwords, silent upload failures, seed-priced checkout, and cosmetic image protection. The public catalog and its owner workflow have now been replaced with database-backed reads and writes. This is the first implementation increment of Phase A, not completion of the four-phase roadmap or approval to launch.

Additional defect found: the old owner gate treated every authenticated account as an owner. The new catalog and existing provider/settings server functions require an exact account ID in `OWNER_USER_IDS`. Registration alone does not grant owner access. Authentication is initialized during a request and resolves Hyperdrive, rather than selecting PGlite merely because `DATABASE_URL` is absent. The existing `/login?setup=1` parsing error is fixed.

Changes to the proposed sequence:

- Validate JPEG/PNG first. This increment explicitly rejects RAW/TIFF and files over 20 MiB. Browser `createImageBitmap` was not a reliable RAW pipeline. Large-file multipart and dedicated RAW development belong in the next ingestion increment.
- A processing job is durable in `catalog_photos` for now; separate queue infrastructure is not provisioned. Requests can retry processing after an expired lease. An older Worker cannot overwrite the result of a newer retry.
- The Cloudflare Images adapter is implemented but has not been verified against the live account. Enabling a binding and choosing the watermark are prerequisites for a real-photo staging test. No production photo is used as a test fixture.
- Keep commerce work paused as requested. Database prices, quotes, entitlements, refunds, print fulfillment and customer proof selections remain later phases. The new gallery page does not present purchase/favorite actions before those workflows are connected.
- Keep the application as one deployable service. Separate modules enforce boundaries; separate microservices are not needed for the first functioning gallery.

## Implemented

- Migration `0005_catalog.sql`: folders, galleries, upload/photo records, derivatives, access grants, attempt counters and audit events.
- Homepage, gallery index, gallery detail, folder pages and About read a shared server catalog. They do not read local gallery/photo arrays. Empty and unavailable states are distinct; server failures never masquerade as an empty library.
- `/organize`, `/upload` and `/library` use the shared Organizer: create folders, create/edit galleries, upload, review durable statuses, retry processing, publish/unpublish and revoke gallery grants. These routes deliberately use a smaller set of working controls. The old advanced Organizer source remains in Git and is not the active catalog editor.
- New galleries start private and unpublished. Publication requires at least one ready photograph. Public indexes exclude private, unlisted and password-protected galleries. Unlisted galleries work by direct link; private galleries remain owner-only.
- Passwords are salted PBKDF2 hashes. Neither plaintext nor hashes appear in browser responses. Unlocking issues an eight-hour HttpOnly cookie backed by a hashed random token. Changing the password/privacy/publication or revoking access invalidates old grants.
- Gallery unlock attempts use a shared database limit of ten per minute per gallery, with audit events. This conservative global limit can temporarily affect legitimate visitors; per-client plus global limits and retention cleanup should follow before broad customer traffic.
- Server upload reservations record the owner, SHA-256, MIME and byte count. The server enforces a 20 MiB streaming read limit, checks the exact bytes and JPEG/PNG signature, and conditionally creates an immutable original key. Original retries accept only matching bytes.
- R2 source and derivative keys are separate. Server image processing draws a configured watermark into preview and thumbnail pixels and requests metadata stripping. Derivatives must be read back and checksum verified before the photo becomes ready. Failed processing retains the original and a retryable `needs_review` state.
- Public image delivery checks the current gallery policy on every request and serves only ready derivatives, with `private, no-store`. Original delivery requires the configured owner. No original keys or signed object URLs are included in public catalog responses.
- Gallery lightbox supports previous/next, arrow keys, Escape and native dialog focus containment. Contact points to the supplied Instagram account. No clients, awards, sales or sample portfolio photographs were invented.

## API boundaries

### Second increment: photo management

Migration `0006_photo_management.sql` adds customer-visible captions, display order,
hidden/archive flags and optimistic photo revisions. The Organizer can edit these
fields and restore archived photographs. Lower display-order numbers appear first;
ties retain upload order with an ID tie-breaker. This is a numeric ordering control,
not drag-and-drop or bulk editing.

Hidden and archived photographs are excluded from public index/detail responses and
their old preview/thumbnail endpoints return 404. The allowlisted owner can still
read their previews and originals. Archive is reversible and does not delete R2
objects. It cannot recall image bytes a visitor already downloaded. Public DTOs
expose captions but not owner editing state. Edits and audit events share one SQL
statement; stale revisions return 409. A partial index covers visible ready photos
in gallery display order.

Staging must apply **both 0005 and 0006**, in order, before deploying this revision.
Neither migration has been applied to the live database by this increment.

Second-increment verification: all 235 tests passed (195 script tests plus 40
application tests, including eight catalog tests); typecheck, lint (six existing
warnings) and the Cloudflare build passed in `/private/tmp/wgp-photo-controls.rTmKBc`.
The copy contains HEAD plus this increment and retains the baseline files missing
from the working folder. The new photo editor has not yet received browser-based
or live-provider acceptance testing. The database tests cover cross-instance
visibility, direct-media denial, original retention, restore, ordering, stale
revisions, validation and atomic audit recording.

All operations use `/api/catalog`. Mutations require a matching Origin header. JSON responses and images are not publicly cached.

| Request | Access | Purpose |
| --- | --- | --- |
| GET `?op=index` | Public | Published, unrestricted public gallery read model |
| GET `?op=detail&id=…` | Gallery policy | Gallery and ready photograph metadata |
| GET `?op=media&id=…&kind=preview` or `thumb` | Gallery policy | Watermarked bytes only |
| GET media with `owner=1` | Owner | Owner preview or original delivery |
| GET `?op=owner` | Owner | Folders, galleries, ready photos and upload statuses |
| POST `?op=gallery` / `folder` | Owner | Validated catalog writes; gallery revisions prevent stale saves |
| POST `?op=photo` | Owner | Caption, display order, hide, archive/restore; photo revision required |
| POST `?op=reserve` | Owner | Immutable original reservation and duplicate detection |
| POST `?op=upload&id=…` | Reserving owner | Bounded binary upload, byte verification and processing |
| POST `?op=retry&id=…` | Reserving owner | Retry processing an existing stored original |
| POST `?op=unlock&id=…` | Rate limited | Password validation and scoped access cookie |

## Staging deployment prerequisites

Do not merge this branch into the production deployment until these steps are complete. The production domain and SmugMug are unchanged.

1. Use a separate test database and private R2 bucket. Apply `0005_catalog.sql` after migrations 0001–0004. The standard build's migration script needs `DATABASE_URL`; a Hyperdrive binding alone does not run migrations during builds. Do not point a local validation build at production inadvertently.
2. Set `BETTER_AUTH_URL` to the exact staging HTTPS origin, retain a strong `BETTER_AUTH_SECRET`, and use `VITE_AUTH_ENABLED=true` for both build and runtime. Create the intended account, inspect its server-generated ID, then set `OWNER_USER_IDS` to that ID. No first-visitor auto-promotion is implemented.
3. Configure the existing four R2 variables for the **test** bucket. Verify that its public development URL and any public custom domain are disabled. Application policy cannot make an independently public R2 bucket private.
4. Enable the Images binding named `IMAGES` in the staging Worker configuration. Add `"images": { "binding": "IMAGES" }` to that deployment's Wrangler config when enabling it. This service may incur transformation charges; no paid resource was provisioned by this change.
5. Store an approved transparent PNG watermark in the private bucket and set `CATALOG_WATERMARK_KEY` to that exact object key. No watermark means processing stops at `needs_review`; there is no clean-preview fallback.
6. Test owner login on the staging domain. Upload representative, user-approved JPEG/PNG files to a private gallery, confirm sizes/checksums and ready derivatives, then publish a separate test gallery. Verify it from a fresh signed-out browser. Repeat with a password-protected unlisted gallery and a private gallery. Confirm originals cannot be fetched anonymously.
7. Keep purchases unavailable until Phase C replaces the old seed-priced checkout path and verifies Stripe separately. The old commerce server code is still present. **This branch is not a commerce launch.**

Official adapter references: [Images binding](https://developers.cloudflare.com/images/optimization/binding/) and [watermark overlays](https://developers.cloudflare.com/images/optimization/draw-overlays/).

## Verification evidence

Tests exercise a real in-memory Postgres-compatible PGlite database using the actual migration and repository SQL. The media adapter in those tests is a controlled object-store/processor fixture, not live R2 or Cloudflare Images.

- `npm run typecheck`: passed in an isolated copy of HEAD plus the authored patch.
- `npm run lint`: passed, with existing warnings; fixed the existing empty-catch lint error in the app-data connector.
- `npm run test`: all 233 tests passed in the final isolated validation copy (195 script tests plus 38 application tests, including six catalog integration/regression tests).
- `npm run build`: passed in the isolated copy; production database migration correctly skipped because no `DATABASE_URL` was supplied.
- `npm run build:cloudflare`: passed on the final staged implementation, with existing PGlite direct-eval warnings.
- `npm run check:auth`: local development/build settings agree (sign-in off in the baseline local configuration). This checks configuration consistency, not production authorization.
- `node scripts/catalog-browser-check.mjs`: passed against the local server. Real checks: empty catalog, anonymous owner denial, cross-origin mutation denial, 375/768/1440 layouts. Intercepted UI fixture checks: gallery navigation, password form, lightbox arrows and Escape.
- `node scripts/catalog-auth-check.mjs`: passed with a separate local auth-enabled server on port 8090. A real ephemeral account/session was created; its owner read and write requests were rejected with 403 because it was not allowlisted. The test created no production account.

During work, unrelated tracked assets and `scripts/grok-pwa-shared.d.mts` disappeared from the working folder. Those deletions were not included in this patch. Validation used a temporary archive of HEAD plus only the authored changes, preserving those unrelated deletions in the user's working folder. In that folder itself, the missing declaration breaks typecheck and the missing PWA icon breaks one existing test; these are not hidden or reported as passes there.

Not yet verified: actual allowed-owner login on Cloudflare; real R2 uploads and Images transforms; visible watermark/GPS stripping on output files; Worker CPU/memory under representative photos; private bucket configuration; production/staging migration; interrupted network uploads against the live provider. These are the remaining Phase A acceptance gates.

## Remaining work from the audit

Phase A: provision staging; prove the real provider path; add multipart/resumable uploads and RAW/TIFF support through a suitable processor; move processing to a durable queue for larger batches; add richer sports metadata, bulk/drag ordering and folder moves; review/import old local data explicitly; paginate large libraries; clean expired grants/attempt counters and orphaned derivative objects.

Phase B: persistent customer favorites/proof lists, notes and notifications, policy-backed download actions, and customer/owner proof review across devices. Legacy favorites and keyword pages still use local storage and must not be presented as completed server workflows.

Phase C: database catalog/pricing, server quotes, canonical order/entitlement state, coupon accounting, Stripe tests, refunds and manual print fulfillment. Stripe work stays paused until requested.

Phase D: approved sports metadata, publishing automation, reviewed AI suggestions, QR access and licensing inquiries after the above gates pass.
