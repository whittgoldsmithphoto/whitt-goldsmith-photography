# Staging recovery and payment evidence — September 5, 2026

## Latest verified checkpoint — 16:57 EDT

- Staging source `e6aff5a1cb6e4b743d719ecfe660ce7122deaf55`, Cloudflare version `19418e8a-dcf0-4676-879c-d7d21dae0c33`, includes the customer archive route, native attachment form, and scheduled processing. Migration 0032 and the album ZIP flag are enabled in staging only.
- Recovery completed: the football gallery has **131 ready photos, 131 distinct original checksums, 1,495,097,931 original bytes**. These totals match the 131 local source JPEGs. The final failed original, SWG01676.jpg, was recovered with an explicit operator-generated set of watermarked, metadata-free previews; all seven uploaded objects were read back and hash-verified. The exact original is unchanged. This is not a claim that automatic processing of oversized images is fixed.
- `scripts/recover-large-photo.mjs` documents that narrowly scoped staging operation. `scripts/recovery-transaction-check.mjs` verifies the guarded transaction and rejection of repeated execution against changed state. The Postgres safety review informed short timeouts, row locking, and identity/state guards.
- New hosted sandbox order `32c4e1df-0d66-4792-b956-283c86787fc6` was paid through Stripe test Checkout for **$29.95**. The returned server-confirmed customer order contains **131 photographs**, three attempts per photograph, and expiry September 19. No real money was charged and saving payment information was disabled.
- The customer requested the full album ZIP. Preparation is pending hosted verification; no successful hosted ZIP delivery is claimed yet.
- Production and the SmugMug domain remain unchanged. No backups were removed.

The sections below preserve earlier checkpoints; the latest checkpoint supersedes their upload and archive-wiring pending notes.

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
