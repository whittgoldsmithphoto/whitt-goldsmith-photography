# Photographer feature program

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
