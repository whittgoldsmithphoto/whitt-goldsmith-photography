# September 5 repair checkpoint

The subsequent metadata/smart-collection source work and all eight requested
feature groups are tracked in [Photographer feature program](PHOTOGRAPHER_FEATURE_PROGRAM.md).
Metadata and private smart collections are now enabled on Cloudflare staging;
see that document's activation section for live evidence and remaining gates.

This checkpoint supersedes old decision requests and deployment claims, not the unfinished engineering backlog in `BACKEND_REVISION_REMAINING.md`.

## Owner decisions already made

- CCES Football @ St. Joes may be public. The deployed preview contains three real photographs, not the complete shoot.
- Digital-only: USD 4.95 per full-resolution photograph; USD 29.95 for all photos in the purchased gallery snapshot. Personal and commercial use, no resale.
- Purchased entitlement expiry is 14 days with a three-download limit per photograph. A whole-gallery ZIP is a separate unfinished feature.
- Stripe Tax selected; actual provider configuration must still pass preflight. Do not substitute assumed zero tax.
- Retain backups indefinitely. A retention preference does not establish an independent backup or a successful restore.
- The supplied logo is the watermark asset. No further logo selection is needed.
- Keep the SmugMug domain unchanged. Do not enable prints or live charging as a side effect of deployment.

## Repaired and observed

- Corrected the Cloudflare build/deploy path: generic Vercel builds were followed by deployment of stale Cloudflare artifacts. Release script builds Cloudflare output, preserves runtime settings, and verifies the served revision and assets.
- Restored missing staging Stripe account, tax code, tax mode and webhook-enabled settings from the previous Worker configuration. No live keys or domains changed.
- Applied missing migration `0028_gallery_downloads.sql` to the isolated staging Neon database in a transaction. Album quote now returns USD 29.95.
- Added the album product to the simple Selling editor and preserved active status when editing product text.
- Surfaced safe checkout preflight errors instead of an unexplained failure. No credential or SQL payload logging.
- Rejected unsafe ZIP paths and suspicious expanded size/compression before extraction. Extraction remains bounded synchronous extraction, not resumable streaming.
- Verified signed-in Organizer and gallery settings save, public three-photo viewing, viewer next/close, and anonymous owner/original access denial.
- Corrected contradictory private-test gallery copy through the owner UI.
- Release `0288d7b` passed 423 tests, typecheck, and lint (zero errors; seven existing warnings), then deployed to staging. Automated checks are not payment acceptance.

## Immediate blocked acceptance

Stripe sandbox Tax still has an unconfirmed California placeholder head-office address. The correct address must be entered by the owner in Stripe. Do not submit invented address details, bypass the tax preflight, or enable live checkout.

After that: complete real sandbox checkout for individual and album products, verified webhook settlement, customer original downloads, count/expiry enforcement, duplicate-event handling and refund revocation. Confirm album purchase grants only its immutable paid photo snapshot. Then independently validate live account configuration and gates before enabling live sales.

## Remaining engineering / operations

- Full-shoot import and interrupted/duplicate upload acceptance; current gallery has only three photographs.
- Whole-gallery private ZIP packaging and browser-closure recovery; current album entitlements allow individual photo delivery.
- Independent backup destination, indefinite retention enforcement and an actual restore drill.
- Live cross-account proofing/revocation and independent-connection payment/coupon concurrency tests.
- Metadata/version/membership/collection and integration-publisher features, notification provider delivery, and remaining performance/security/operational tasks in the central backlog. Some roadmap entries have code scaffolding but no live acceptance.
- Production migration/configuration acceptance remains separate from staging; custom-domain cutover requires the owner's later approval.

Screenshot blackout cannot be guaranteed for ordinary website photographs. Watermarks, private originals and entitlement checks protect delivery; right-click blocking is only a deterrent.

## Latest uniform-interface and reliability pass

- Published a shared charcoal/blue photography interface, Oswald headings, desktop left navigation and compact mobile navigation. Removed yellow accents and color filters from photographs; added a visible Purchases entry.
- Fixed the upload picker clearing its live FileList before copying selections, and corrected R2's multipart resume argument order. Added regression tests for both.
- Fixed integrity verification to accept the exact checksum-qualified original key used by the media pipeline, while still rejecting keys belonging to another photo or checksum.
- Owner dialog save errors now appear inside the dialog, draft values survive errors, proof filters have accessible labels, and duplicate Selling errors were removed.
- Local customer browser acceptance passed: pending/paid purchases, download counts, cross-account denial, refund revocation and persisted pricing. Local owner/proof browser acceptance passed at 375/768/1440 widths, including policy saves, failed saves, folder operations and access checks. These use provider fixtures and do not replace Stripe/R2 live acceptance.
- Production dependency advisory scan reported zero vulnerabilities. This is not a full historical secret scan or a general security guarantee.

### Import is blocked, not complete

The 131-photo football batch was stopped after provider failures. Its displayed result was 0 ready, 17 processing, 2 duplicates, 51 failed and 61 skipped. A subsequent single-file retry also failed. The three previously ready photographs remain the verified public preview; do not present the full shoot as delivered.

Cloudflare's actual Workers plan is Free and the queue logs report `Exceeded CPU Limit`. The owner has been asked to approve the displayed Paid plan charge in Cloudflare. Staging processing is explicitly paused with `CATALOG_MEDIA_PROCESSING_PAUSED=true`; diagnostics shows the pause. Queue messages are delayed, not discarded, but can eventually reach the dead-letter queue and must be reconciled with durable jobs when resuming.

After the capacity change, verify the account plan, set the staging pause flag false through a reviewed release, inspect queued/failed/dead-letter jobs, retry the import safely, and verify all original checksums and public derivatives. Automatic batch uploads now stop after three consecutive transfer failures. Native derivatives are processed sequentially to reduce concurrent memory pressure. Neither mitigation replaces live capacity acceptance.

### Album archive progress (not yet customer-ready)

Implemented and unit-tested a private streaming ZIP packer and bounded R2 multipart sink. The core validates a frozen manifest, hashes each original, rechecks authorization, handles corrupt/missing originals, applies backpressure, and verifies the stored archive after commit. No customer endpoint or decorative download control was added.

Still required: bind the core to durable archive jobs and immutable paid snapshots; enforce leases/revocation and transactional download allowance consumption; expose status and authorized delivery; test retries, interrupted processing, browser closure, expiry and refund behavior on real infrastructure. Individual-photo album entitlements remain the current delivery path.

### Owner-dependent items

1. Cloudflare paid-capacity approval, then controlled import recovery.
2. Correct business/head-office address in Stripe Tax, followed by real sandbox acceptance. No invented address or live charge.
3. Independent backup destination selection, followed by indefinite-retention setup and a restore drill.

The broader backlog above remains open. Production, prints, live checkout and custom-domain cutover have not been enabled by this repair pass.

### Next archive implementation slice (source only)

- Added migration 0029 and a saved archive job ledger with content-derived manifest identity, idempotent enqueue, customer-scoped lookup/cancellation, atomic exclusive claims, expiring lease renewal, stale-worker fencing and five-attempt retry limits. Each attempt writes a different private ZIP key.
- Connected the ledger contract to a background worker coordinator and the real ZIP/R2 storage adapter. Access is checked before, during and after packing; failed final checks or lost leases discard the attempt's private output instead of publishing it.
- Fixed cancellation during stalled original reads and cancellation during initial authorization. Neither is allowed to commit a ZIP.
- Verification: 451 tests passed, typecheck passed, lint zero errors/seven baseline warnings. Includes a real packer + storage adapter + PGlite job-ledger integration test using an in-memory storage provider. This is not a live R2, independent-connection PostgreSQL or Stripe acceptance result.
- These are internal building blocks, not an activated customer feature. The worker requires a real paid-snapshot authorization implementation. Customer request/status/delivery routes, atomic allowance consumption, dispatch wiring, database migration on staging and live provider acceptance are still open. No changes to live-sales gates, production, the processing pause or the custom domain.

### Previous deployed release verification

Release `be682c062bb8f533d300b2a1e40c0eebc3d3aa51` passed 441 tests, typecheck and lint (zero errors; seven existing warnings). Cloudflare staging version `0044a432-2e4e-4567-ad95-a9a5b8a58679` was deployed and its revision plus 15 application assets verified. An authenticated browser reload confirmed the processing-pause notice. The organizer now displays eight visible football photos: several queued items completed before the pause took effect. The full 131-photo import and original-by-original acceptance are still unfinished.
