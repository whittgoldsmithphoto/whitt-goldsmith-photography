# Photographer feature program

## Perpetual license and real album acceptance — September 5

Owner confirmed permanent personal/commercial usage rights, no resale. Only
download access expires after three downloads per photo or 14 days, whichever
comes first. Both single-photo and album product licenses were saved through
the hosted owner UI; historical paid snapshots were not rewritten.

Stripe sandbox preset category and staging runtime
`CATALOG_STRIPE_DIGITAL_TAX_CODE` now match `txcd_10501000` (Digital
Photographs/Images, downloaded, non-subscription, permanent rights). The
Stripe UI confirmed the category save and Wrangler confirmed the staging
setting update. Live Stripe settings and tax registrations were not changed.

Real sandbox Checkout for album quote `018bcd19-0dc9-4795-b925-0f781e66dc54`
completed using synthetic buyer data and Stripe's documented test card, with
optional Link enrollment disabled. Order `50d3d14c-e1de-4b34-b89f-102af70e4c1e`
returned server-confirmed **paid**, $29.95, and eight photo entitlements expiring
September 19. This proves the album's per-photo delivery flow, not ZIP delivery,
real-money payments, refund/replay acceptance or the full 131-photo import.

SWG01452.jpg was downloaded three times; each 6,826,940-byte file matched the
local source SHA-256 `7a3957f4b901ce657796539a760a7178ea568e3212668fe2a3bbd748113aba93`.
The hosted order counter progressed 3 → 2 → 1 → 0, then disabled the download
button. A hostile fourth server request and elapsed-time expiry still need
live negative acceptance; existing automated tests cover those rules.

Read-only Neon inventory found 13 football-gallery jobs stalled on attempt
four of five, and 25 exhausted processing jobs plus one failed job in the test
gallery. No original/gallery assignments were modified. Release `7f38e31`
resumed staging processing after Workers Paid verification; Cloudflare version
`6becb97b-db87-4b07-8a74-a78371e102b9` served the expected revision and 15 assets.
The first post-release inventory was unchanged; completion is not yet claimed.

An additional regression reproduces exhausted crashed leases staying
"processing" forever. Dispatch reconciliation now marks only expired,
exhausted jobs failed in a bounded, skip-locked statement, without resetting
attempts automatically or changing originals/visibility. Owner retry can then
reset a failed job normally. The regression verifies live leases are retained,
stale completion is rejected, and explicit retry works.

The user's phrase "remove backups" is awaiting clarification; no backups have
been deleted and remote backups are not claimed complete.

## Launch acceptance follow-up — September 5

This supersedes the older Workers Free/address blockers below. The account's
Workers plan was verified as Paid. Stripe sandbox Tax displays South Carolina
as its head office, but its preset category is Electronically Supplied Services.
A real owner quote for SWG01565.jpg in the football gallery returned $4.95.
Opening sandbox Checkout was blocked by the provider Tax configuration check;
no successful purchase, webhook settlement or customer delivery is claimed.

Release `5f93135ad244f7e45567da2f778a844aeaa057eb` replaces the generic Tax
failure with distinct mode, setup-status, provider, category and registration
messages while retaining every existing fail-closed condition. The new test
failed against the old generic message, then passed. The canonical staging
release completed the full tests, typecheck and lint, deployed Cloudflare
version `9b4d7472-2068-48bb-927f-a6eb5105846f`, and verified its revision and
15 served assets. The repair branch is pushed to GitHub.

The historical reviewed code `txcd_10505000` describes limited-rights finished
artwork, not simply a time-limited re-download link. Before changing the
classification, confirm whether the personal/commercial usage license is
permanent; do not alter Tax settings just to make the preflight pass.
Reference: https://docs.stripe.com/tax/tax-codes

Desktop snapshot `2026-09-05T19-17-29-000Z` under
`~/Desktop/Whitt Goldsmith Photography Backups` contains source at `621b43f`,
locally available Git history, all 131 original JPEGs and PNG/SVG branding.
135 file checksums passed and a Git restore was verified. It does not contain
Neon database data, R2-only objects or cloud secrets and is not a full server
backup. It also predates this diagnostic release. No automatic expiry is set.

Still open: full-gallery assignment/recovery and media acceptance, remote
database/object backup and restore, individual and album Stripe acceptance,
customer ZIP delivery, production configuration/migrations and live activation.
Processing and live sales remain paused; SmugMug/domain routing is untouched.

## Cloudflare staging activation — September 5

This activation supersedes the source-only deployment notes below for metadata
and smart collections. Neon project WGP Catalog Staging was verified in the
signed-in console, then migrations 0029, 0030 and 0031 were applied together in
a guarded transaction. Photo records stayed at 51 and orders at two.

Release `d09ddc7156d8acb39892aaee099a1d941edd7690` is deployed to
`https://wgp-catalog-staging.whittgoldsmithmedia.workers.dev` with
`CATALOG_LIBRARY_METADATA_ENABLED=true`. Cloudflare version
`36d3f4b0-9978-4ae2-bf7b-5bbc0b00d89b` and 15 application assets were verified.
The release passed 456 tests, typecheck and lint (zero errors/seven warnings).

Live acceptance: owner metadata loads; a temporary keyword on the exact
synthetic PAYMENT-TEST-NOT-FOR-SALE.png saved and persisted after reload, then
was removed through the UI. The private collection
“CCES Football @ St. Joes — library” saved and reopened after reload. Anonymous
metadata and collection API requests both returned 401.

Archive database infrastructure is installed but customer ZIP delivery remains
unfinished and disabled. Cloudflare still displays Workers Free, so photo
processing remains paused. Live checkout/download gates, the production Worker
and SmugMug/custom-domain routing were not changed.

During verification, the existing unlisted payment-test gallery also contained
real football filenames, including three ready photos. No photos were moved or
deleted. Full-shoot recovery must reconcile gallery assignment as well as job status.

This tracks the owner's eight requested feature groups. Source implementation,
local acceptance and live activation are different milestones. No group is
complete merely because a table or UI control exists.

| Requested group | Current slice | Remaining |
| --- | --- | --- |
| Advanced metadata, keywords, filters, bulk editing | Private normalized keywords, rating, label, notes storage; indexed filters; atomic revision-checked bulk writes; owner API and Organizer keyword/rating/label editor | EXIF/IPTC/XMP extraction and provenance, advanced camera/date filters, notes editor, real staging acceptance |
| One original in multiple galleries; replacement/history | Existing canonical originals unchanged | Membership schema and compatibility migration, independent gallery presentation, immutable replacements/version rollback, paid-reference preservation, all read/write consumer migration |
| Smart collections | Owner-scoped saved allowlisted filter rules; revision-safe updates; Organizer save/reopen of dynamic filters for a gallery | Cross-gallery collection UI, membership/publication evaluation and explicit publication revisions; larger saved-collection navigation; live acceptance |
| Invitations, guest proofs, rounds, comments, notifications | Existing account-based proofing remains working | Unified scoped invitations/revocation, guest identity binding, rounds and threads, durable notification outbox/provider delivery |
| Folder/ZIP import and interrupted upload recovery | Existing upload fixes and durable media queue preserved | Streamed archive ingestion, mapping/retry UX, real provider interruption/recovery and resource-budget acceptance |
| Packages, coupons, pricing inheritance, reconciliation | Existing digital offers, owner pricing and gated payment paths preserved | Expanded package semantics, inherited prices, conflict/refund/concurrency acceptance and real Stripe workflow |
| Monitoring and truthful analytics | Existing diagnostics/processing pause preserved | Durable operational views, scoped events and real aggregates, retention and fault acceptance |
| Publishing integrations and branding/settings | Existing storefront styling preserved | Scoped publisher credentials/client, conflict handling, server-backed settings and branding editor |

## Metadata and smart-collection implementation boundary

- Additive migrations `0030_library_metadata.sql` and `0031_smart_collections.sql`.
- Owner-only `/api/catalog/metadata` and `/api/catalog/collections`; reads are
  private/no-store, writes require same-origin JSON and bounded payloads.
- Both require `CATALOG_LIBRARY_METADATA_ENABLED=true`. Do not enable before
  migrations and isolated acceptance. No deployed database was migrated by this slice.
- Metadata bulk writes lock parent photos in a consistent order and reject the
  entire batch on a missing/stale target. Public captions and originals are not changed.
- Smart rules are data, not executable SQL. A collection reevaluates current
  metadata when opened; saving it never publishes photos or grants downloads.
- Saved collections currently list at most 100 owner records per API page. The
  initial Organizer picker displays matching current-gallery records from that page.
  Larger-library collection navigation is not yet complete.
- Tests use local PostgreSQL-compatible PGlite, not independent Neon connections.
  The browser harness uses real local routes/auth/database with synthetic photo media.

## Deployment and preservation

Local acceptance for this slice: 456 automated tests pass; typecheck passes;
lint has zero errors and seven existing warnings. The full local owner/proof
browser harness passes, including metadata bulk save, reload persistence,
keyword filtering, smart-collection save/reopen, and anonymous/customer denial.
These results do not claim live Cloudflare/Neon acceptance.

Keep Cloudflare photo processing paused until the existing capacity blocker is
resolved. Keep live sales closed until real payment/delivery acceptance. Do not
switch the SmugMug domain. Original objects and historical purchases must not be
rewritten to simplify the later membership/version migration.
