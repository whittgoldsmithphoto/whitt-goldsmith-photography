# Competitive plan implementation

Source brief: ASTRA_SMUGMUG_COMPETITIVE_PLAN.md, supplied September 5, 2026.

## Scope and sequencing

Work continues from `repair/verified-cloudflare-release`, not the older `ui/consolidated-workspace` reviewed by the brief. Existing authenticated, server-backed routes remain authoritative. The plan is not authorization to enable sales, move the SmugMug domain, add a print provider, or replace the photography interface.

Phase 0 comes first. Use the explicit Cloudflare build command: generic `npm run build` also runs migrations. Check formatting without rewriting unrelated files. Keep browser uploads open and avoid deploying over an active recovery workflow.

## Phase 0 baseline

- Locked dependencies installed with `npm ci`: 493 packages, zero reported audit vulnerabilities.
- Baseline automated suite: 472 passing tests, zero failures.
- The existing upload browser smoke test had stale expectations: non-image files are filtered before batching, and several visible button/status labels had changed. Reproduced its timeout and corrected those expectations against the current interface.
- Whole-repository formatting check reports 92 files. This remains a named cleanup item, not a reason to include a broad reformat in a delivery fix. Changed files are formatted separately.
- Desktop/narrow screenshot baselines for public gallery directory, Organizer, Proofs and Selling captured and visually inspected at 1440×1000 and 390×844. No horizontal overflow in those eight checks. These use synthetic local owner fixtures and empty public/proof/order states; populated private client workflows still need their own visual acceptance. Run `WGP_VISUAL_BASELINE=true node scripts/upload-batch-browser-check.mjs` to generate a fresh temporary screenshot folder. Do not claim the competitive epic complete.

## First P0 improvement: safe visible upload retry

User job: recover failed or unstarted transfers without losing the completed batch history or uploading successful files again.

- Organizer retains the complete source-file mapping for a retryable batch.
- Retry selects only failed/cancelled rows and preserves original indexes, completed rows, and total count. Identical filenames cannot cause a completed row to be replaced.
- The retry path still reserves by actual checksum and checks authoritative server status before transferring. It does not assume a lost response means the original was lost.
- Clear labels distinguish retrying transfers from retrying server image processing.
- A RED test failed for the missing retry behavior before implementation; focused tests then passed. Additional coverage rejects mismatched batch indexes and preserves completed rows when a retry is stopped.
- Mounted local browser verification uses real owner authentication and catalog reservations: failed-only retry, unchanged completed rows, safe uncertain-response recovery, stop/retry behavior, and processing recovery passed. Storage and image processing are simulated, not hosted-provider acceptance.
- Final verification: 475 tests passed; typecheck passed; lint had zero errors and seven existing warnings; explicit production build passed. All five changed files pass the formatting check. This commit is not deployed while production gallery recovery remains active.

This is same-tab recovery, not persistent access to local files after a browser restart. Durable upload history remains server-backed; selecting originals again after losing browser file handles is still necessary.

## Phase 1 slice: QR gallery sharing

- Existing cover selection, nested folders and Copy link already exist; they were not reimplemented.
- Added Download QR code beside existing sharing controls for published public/unlisted galleries. The SVG is generated locally with the MIT-licensed `qrcode` package, pinned in the lockfile; no external QR service receives gallery URLs. Library reference: https://github.com/soldair/node-qrcode .
- QR contains only the current site's gallery-page address. It does not publish a gallery, grant access, include passwords, or link to an original. Existing password and purchase checks remain server-authoritative.
- Unit tests first failed for missing implementation, then passed for safe URL generation, draft/private refusal, and standalone black-on-white SVG output. Phone-camera scan testing is not claimed.
- Browser smoke coverage now publishes only a synthetic local gallery through its real settings form and verifies the named SVG download and customer-facing confirmation. This remains separate from production acceptance.
- Verification: 478 automated tests, typecheck and explicit Cloudflare production build passed; lint remains zero errors/seven existing warnings. Mounted browser publish/QR download passed after fixing an ambiguous accessible name on Visibility. No deployment or live-sales activation was performed.

## Remaining sequence

1. Complete Phase 0 visual baselines and record final checks for each commit.
2. Finish hosted gallery/ZIP recovery and payment acceptance separately; current pending details are in ACCEPTANCE_2026_09_05_RECOVERY.md.
3. Inventory existing gallery settings, folders, proofs and commerce before adding Phase 1 models. Prioritize missing behavior instead of parallel duplicate settings.
4. Implement one tested gallery-delivery slice at a time: presentation/presets, client activity and sharing, then the complete private-gallery invitation/proof/download audit workflow.
5. Only then expand the workbench, sports metadata review, and platform/commerce phases.

Originals, licenses, access enforcement, and existing price settings must remain unchanged unless the user requests a change. Never turn an unfinished test into a readiness claim.
