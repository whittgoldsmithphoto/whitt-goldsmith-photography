# Staging recovery and payment evidence — September 5, 2026

## Latest verified checkpoint — 16:57 EDT

- Staging source `e6aff5a1cb6e4b743d719ecfe660ce7122deaf55`, Cloudflare version `19418e8a-dcf0-4676-879c-d7d21dae0c33`, includes the customer archive route, native attachment form, and scheduled processing. Migration 0032 and the album ZIP flag are enabled in staging only.
- Recovery completed: the football gallery has **131 ready photos, 131 distinct original checksums, 1,495,097,931 original bytes**. These totals match the 131 local source JPEGs. The final failed original, SWG01676.jpg, was recovered with an explicit operator-generated set of watermarked, metadata-free previews; all seven uploaded objects were read back and hash-verified. The exact original is unchanged. This is not a claim that automatic processing of oversized images is fixed.
- `scripts/recover-large-photo.mjs` documents that narrowly scoped staging operation. `scripts/recovery-transaction-check.mjs` verifies the guarded transaction and rejection of repeated execution against changed state. The Postgres safety review informed short timeouts, row locking, and identity/state guards.
- New hosted sandbox order `32c4e1df-0d66-4792-b956-283c86787fc6` was paid through Stripe test Checkout for **$29.95**. The returned server-confirmed customer order contains **131 photographs**, three attempts per photograph, and expiry September 19. No real money was charged and saving payment information was disabled.
- The customer requested the full album ZIP. Preparation is pending hosted verification; no successful hosted ZIP delivery is claimed yet.
- Production and the SmugMug domain remain unchanged. No backups were removed.

## Subsequent checks — 17:12 EDT

- Production owner access is confirmed in the browser. Its separate catalog contains three draft photos, zero orders and zero entitlements; production schema is still at `0022_payment_recovery.sql`. Earlier notes saying owner setup is pending are superseded. No production write was performed.
- The hosted 131-photo ZIP job was claimed by the cron processor but its first attempt failed and entered retry. It did not publish a download. Successful payment is **not** successful album delivery; live acceptance remains blocked.
- Safe failure-category reporting was added after a failing regression test, then its six focused tests and typecheck passed. The canonical staging release passed its full checks and deployed source `fac8c20e91f22f93bca54c78559c54c7059cb45d`, version `c8ab74d4-4865-4401-89b0-7ebc0c7b0359`, with revision and 15 assets verified.
- Added `python3 scripts/verify-album-zip.py DOWNLOAD.zip ORIGINAL_FOLDER`: bounded-memory, read-only ZIP verification of every original size and SHA256 without extracting files. Its synthetic exact/mutated-byte regression passed. Running it on a real hosted download is still pending. The verifier test requires Python 3.

## Hosted CPU failure and queue correction

- Cloudflare tail classified the second full-album invocation as **Exceeded CPU Limit** (scheduled at 21:10:22 UTC). Its frequent-cron CPU budget is 30 seconds, distinct from elapsed time; a heartbeat alone did not prove forward progress or completion.
- Album packaging now runs through a strictly parsed envelope on the existing private media queue. Cron dispatches durable work only. Both environment configurations bound CPU to 300,000 ms for queue invocations, batch size one, concurrency two. Paid snapshot checks, leases, output integrity checks, and download reservations are unchanged.
- Increased the bounded multipart buffer from 5 MiB to 16 MiB to reduce storage round trips. Failing queue-envelope and multipart-size tests were observed before implementation; 14 focused queue/storage/worker tests and typecheck then passed. Hosted delivery after this correction remains pending.
- Official limits: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/queues/platform/limits/ . Queue wall time remains limited to 15 minutes; this change is not a claim of unlimited processing.
- Production recovery branch `pre-live-readiness-2026-09-05` (`br-empty-water-a52qcp7y`) was created with auto-delete Never, then independently queried: schema 0022, three photos, zero orders and entitlements. This is a same-provider recovery point, not an independent full restore test. Production's active database was not changed.
- Fresh Desktop source/history backup: `Whitt Goldsmith Photography Backups/verified-release-2026-09-05-Uvq3LH`, revision `451119f`; complete Git bundle verification passed. Older backups were preserved.

## Production release and hosted delivery checkpoint

- Production source `900fb4b8e24c7d0ec39d26416189ea2bc39a9d70` deployed as Cloudflare version `de7e117c-0443-4f17-b1c3-c7eb57990b9f`. Release checks passed: 472 tests, typecheck, lint with seven existing warnings and no errors, exact revision and 15 referenced assets. Production owner Organizer was then opened successfully with the existing owner session; its three-photo draft was intact. Live checkout/download flags remain false; no custom domain was changed.
- The corrected staging queue completed the 131-photo paid album preparation. Customer UI exposed Download album ZIP. One native download was requested and began transferring to the browser. A separately loaded order page showed **all 131 photos with two attempts remaining**, versus three before the ZIP request. Full downloaded-byte verification is still pending while transfer runs; a ready button alone is not the completed acceptance test.
- A new hosted single-photo sandbox purchase for SWG01910.jpg completed at **$4.95**, order `7b174743-6f75-4367-84b0-6c1a2be5b482`. The application returned server-confirmed paid status, the correct perpetual personal/commercial/no-resale license, and three attempts expiring September 19. Synthetic Stripe test-card details were used and saving payment information was unchecked. Its original download was requested; downloaded checksum verification remains pending.
- Production recovery upload of all 131 source files started through the supported browser file chooser. The current batch reached 24 checked, with existing originals recognized as duplicates. This is an in-progress upload, not proof that all production photographs are ready. Keep the production Organizer tab open until completion.

## Production schema upgrade completed

- Applied canonical migrations 0023–0032 to the active production branch `br-twilight-term-a597tv8m` after a successful local rehearsal with three existing photo fixtures. The generated transaction used an advisory lock, 3-second lock timeout, 15-second statement timeout, baseline guards, and exact before/after JSON comparison of all existing photo records.
- Neon reported COMMIT. A separate subsequent query confirmed **32 migrations, latest 0032, three photos, zero orders, zero entitlements**. The recovery branch was not modified.
- `scripts/prepare-production-upgrade.mjs` retains the reproducible preparation/rehearsal, including rejection of replay after the baseline changes. It never directly connects to a remote database.
- Created the missing production dead-letter queue `wgp-media-production-dlq`; the existing production queue had one producer and zero consumers before the upcoming deployment.
- Production release tooling now requires clean committed source and verifies its exact Git revision plus referenced application assets after deployment. Focused negative verification tests passed. Deployment itself is pending at this checkpoint, and sales remain disabled.

The sections below preserve earlier checkpoints; newer checkpoints supersede their upload, owner setup, schema, and archive-wiring pending notes.

## Verified hosted behavior

- Staging media processing resumed; exhausted expired leases now become explicitly failed instead of remaining processing indefinitely. Current deployed source: `163243cc9bf09eb1961e83a8f52e3129de48e748`; Cloudflare version `eb276ce2-035d-4bbd-9cd3-4f7b5590a207`.
- Sandbox Stripe Tax preset and staging digital product tax code set to `txcd_10501000` (downloaded photographs, permanent rights). No claim about legal tax liability is implied.
- Single photo price remains $4.95; album remains $29.95. Both saved licenses specify perpetual personal/commercial use without resale. Download access is three downloads per photo or 14 days from purchase, whichever comes first; rights do not expire.
- Sandbox album order `50d3d14c-e1de-4b34-b89f-102af70e4c1e` returned paid after hosted Stripe Checkout. Its immutable purchase snapshot contains eight photographs. No real money was charged.
- Three separate hosted downloads of SWG01452.jpg matched the original: 6,826,940 bytes; SHA256 `7a3957f4b901ce657796539a760a7178ea568e3212668fe2a3bbd748113aba93`. UI allowance reached zero and disabled the button. A hostile fourth hosted HTTP attempt was not tested.
- Recovered 26 nonduplicate, unpurchased football photo records from the test gallery into CCES Football @ St. Joes. Guarded transaction preserved all 51 existing photo records and the paid order's eight-photo snapshot. Audit action: `photo.recovered_from_test_gallery_c4e58299_20260905`. Three duplicate source records were preserved, not deleted.
- Full 131-file source recovery upload started in the signed-in Organizer. Upload completion and final ready-photo reconciliation remain pending. Do not close or reload its active browser tab.

## New local archive safeguards

- Verification: 464 tests passed; TypeScript passed; lint passed with seven pre-existing warnings and no errors. These checks do not substitute for hosted payment, ZIP or restore acceptance.
- Paid immutable manifest authorization, customer isolation, refund/expiry/exhaustion rejection, atomic all-photo reservation and verified private archive streaming have local database/unit coverage.
- Migration `0032_archive_delivery.sql` is NOT yet applied to staging or production.
- Archive HTTP/runtime modules are NOT connected to a public route, scheduled handler, or customer UI. Feature gating additionally requires accepted customer delivery. No ZIP availability is claimed.
- Do not implement full-album delivery with a multi-gigabyte browser `blob()` buffer. A bounded-memory browser download path is still required.

## Remaining acceptance work

### Subsequent customer ZIP integration

- Staging migration 0032 committed with a gallery/environment guard, advisory lock and short transaction timeouts; no production migration was performed.
- Customer album preparation/status controls, same-origin native form download and gated scheduled ZIP processing are now connected in source. Native form delivery avoids a browser-sized `blob()` buffer.
- `node scripts/album-browser-check.mjs` passed with real local authentication/database/routes/UI and exact ZIP byte verification, one allowance consumed and cross-origin form denied. Payment and storage are synthetic in this test; hosted ZIP acceptance remains separate.
- 465 automated tests passed before hosted rollout. New-window download behavior was corrected to same-window native attachment delivery during browser verification.

1. Finish the active 131-photo upload, reconcile processing, verify final public previews and original checksums. Preserve duplicate originals until reviewed.
2. Connect archive route, scheduler and bounded-memory customer download UI; apply migration safely; run hosted whole-album acceptance and independent-connection reservation/refund race tests.
3. Run hosted single-photo checkout, duplicate webhook replay, failed/unpaid and refunded-order denial, expired-access denial and hostile fourth-request denial.
4. Finish independent database/R2 backup and restore verification. Existing desktop source/Git/photos backup is same-device, not an offsite disaster backup. No backups have been deleted. Clarify the user's phrase “remove backups” before any deletion.
5. Live Stripe/payment acceptance and production enablement remain pending. SmugMug and custom domain remain untouched.
