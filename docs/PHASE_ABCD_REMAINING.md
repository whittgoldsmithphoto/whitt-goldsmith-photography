# A–D roadmap: implemented work and remaining gates

September 3, 2026. Compared with the supplied `GROK_NEXT_PHASE_AUDIT.md` and current source. This is the current remaining-work checklist; older increment notes in `CATALOG_PHASE_A.md` and `PLAN_EXECUTION_STATUS.md` include historical statements that predate these additions.

**Not ready to call the whole plan complete or launch commerce.** Staging migrations through 0012 have been applied; final release and live evidence are recorded in `PHASE_ABCD_ACCEPTANCE.md`. Schema/deployment success is not proof of a complete customer workflow. Production/custom-domain promotion remains separate, and SmugMug stays in place.

## Evidence boundaries

- Previously recorded live evidence: three approved football JPEGs uploaded privately, original checksum comparisons, watermarked thumbnails, anonymous original/private-media denial. This does not establish RAW/TIFF, large-batch recovery, public-gallery or payment acceptance.
- Current local evidence: real PostgreSQL-compatible PGlite tests; real HTTP/BetterAuth browser sessions for proofing and sports metadata; upload-batch browser tests with **simulated transfer completion and image processing**; Stripe SDK signature verification with **injected provider readbacks**, not Stripe API calls.
- Read-only scan of the supplied football export folder: 131 eligible JPEGs, no duplicate/unsupported/rejected/unstable files. The scan did not upload, publish, modify originals or write a manifest.
- Report final whole-repository typecheck/lint/tests/build/auth results from the lead agent's validated snapshot. Do not replace those with a claim that these targeted tests certify all code. Unrelated missing tracked assets/declarations remain excluded from authored changes.

## Phase A — trustworthy owner-to-customer photo path

### Implemented

- Shared database-backed public catalog, About and owner Organizer; explicit empty/unavailable states and owner diagnostics.
- Exact-account owner gate, server password hashing, scoped expiring/revocable gallery grants, rate limiting and per-request media access enforcement.
- Immutable private-original reservations, signatures/byte counts/checksums, separate watermarked derivatives, readback checks and durable processing states.
- Caption/order/hide/archive/restore controls; owner preview and original download link.
- Owner-only, read-only original-integrity check compares bounded R2 bytes and SHA-256 with the catalog, distinguishes missing/mismatched/unavailable originals, and never repairs or changes them.
- Sequential bounded-memory batch UI: per-file outcomes, continue after failure, duplicate suppression, safe re-reservation, failed/unstarted-only retry and stop-after-current.
- Folder rename/reparent manager with optimistic revisions, cycle/depth protection and atomic audit recording; galleries can be assigned to folders.
- JPEG preview metadata filtering, including the existing-derivative read path; originals remain unchanged. The three live staging thumbnails and one 2000px preview were inspected without EXIF/XMP/IPTC; the real preview also received visual watermark inspection.

### Locally verified this increment

- Batch browser acceptance: bad file does not prevent a good upload; already-stored duplicate does not transfer; uncertain completion is not marked ready; retry rechecks saved state; stop finishes the active file and skips unstarted files; original filename preserved.
- The browser batch harness uses actual owner authentication and reservation/database routes, but mocks the provider completion and displayed images.
- Targeted metadata/privacy tests are separate from visual inspection of actual Cloudflare outputs.

### Remaining

- Complete/record the **live** owner-upload → published staging gallery → anonymous watermarked-photo path, plus private/password access and revocation in clean sessions.
- Live duplicate detection, full-preview decoding/watermark placement and private-tag removal passed for the approved sample. Interrupted-request/retry behavior, representative Worker CPU/memory limits, newly generated derivative storage and R2 recovery behavior still require broader provider acceptance.
- RAW/TIFF decoding/development; multipart/resumable uploads for large originals; genuinely durable background/batch processing rather than keeping the current browser request open.
- Large-library pagination, bulk/drag ordering, explicit legacy/SmugMug/local-state migration, backup/restore checks and cleanup of expired grants/attempts/orphaned derivative objects.

**Phase A exit remains an observed live public/private access test, not merely a successful staging build.**

## Phase B — customer gallery and proofing

### Implemented and locally exercised

- Responsive watermarked thumbnail/lightbox browsing, captions/filenames, zoom/fit, favorites, keyboard navigation, focus restoration and failed-preview retry.
- Account-backed proof selections and notes, reference IDs, durable revisions, stale-save rejection with the draft retained, and warnings before abandoning unsaved selections.
- Owner proof inbox, revision-specific review acknowledgement, search, pagination and reviewed/unreviewed filters; later customer edits become unread.
- Revision-safe gallery-specific instructions and a persisted `none`/`purchased_only` download policy, safe default `none`. Public copy reflects the policy; neither setting alone grants originals.
- Real local two-session customer/owner tests cover persisted selections/notes, stale writes, access denial, inbox behavior and 375/768/1440 layouts. A proof reference is **not** an anonymous bearer link to private selections.

### Remaining

- Record the same proof workflow on deployed staging across fresh customer/owner sessions, including password-gallery grants and later access revocation.
- Richer comment threads and actual owner email/other notifications. The in-app inbox is not email delivery. Verify the new instructions/policy on staging after final deployment.
- Entitlement/policy-controlled single-photo and whole-gallery download delivery; whole-gallery download SKU/archive generation. Favoriting never grants a download.
- Complete the intended share/buy flows only when their access/commerce contracts exist, and perform final accessibility/offline/error-state checks on deployed galleries.

**Phase B exit is a returning customer's saved selection visible to the owner from another session/device on the target deployment.**

## Phase C — commerce foundation, still closed

### Implemented and locally tested

- Separate commerce schema and owner pricing editor: products/licenses, a global default price list, explicit gallery-list overrides, integer-cent prices, coupons and saved order summaries.
- Authenticated, server-authoritative **pre-tax digital-photo quote previews**, 15-minute expiry, immutable item snapshots and customer-scoped/idempotent order creation.
- Atomic coupon reservations/consumption, gallery/access revision checks and photo availability validation; browser amounts/names/licenses are rejected.
- Atomic internal payment ledger, exact session/payment/amount/currency matching, duplicate-event handling, full-refund revocation and hashed/expiring/customer-bound download-token foundations.
- An isolated, default-disabled **staging/test-only** Stripe webhook adapter verifies raw-body signatures and selected paid/full-refund event paths with strict provider readbacks. Local tests use real HMAC/Stripe SDK verification and mocked provider data; they are not actual sandbox deliveries.
- Verified session expiration and asynchronous-payment failure have a separate atomic ledger (0011), release unpaid coupon reservations and cannot downgrade paid/refunded orders. Expiration may legitimately have no PaymentIntent.

### Remaining before any customer checkout

- Real owner-approved prices, products, license wording, currency and tax treatment/calculation. Current zero-tax/zero-shipping previews are **not** purchasable offers or a determination that no tax is due.
- Stripe Checkout Session creation bound to a saved local order/quote, idempotency and customer cart/checkout/order-detail UI. Checkout intentionally remains unavailable.
- Dedicated test-mode credentials/account/endpoint setup and actual sandbox purchase/webhook replay/failure/refund acceptance. Do not assume the older Stripe endpoint/signing secrets configure the new commerce domain.
- Provider-level acceptance of expiration/asynchronous failure; partial refunds, disputes/chargebacks and fuller out-of-order reconciliation. Unsupported events must not be silently acknowledged as handled.
- The new customer-download handler is implemented behind default-off staging acceptance flags, with bounded byte/hash verification, current policy/password-grant checks and atomic attempt accounting (0013). Real Stripe → R2 delivery and customer-facing order/download UI remain unverified/incomplete. A delivered response attempt is counted even if the browser disconnects; this is not proof of completed download.
- Print crop preview, dimensions/DPI validation, shipping/tax, manual proof-review/fulfillment/shipped states and later a print-provider adapter. Print quote checkout is deliberately rejected.
- Independent-connection PostgreSQL contention tests; PGlite's serialized engine is not sufficient proof of production lock/concurrency behavior.
- Parent/folder price-list inheritance if required, richer owner editing/audit/pagination and accurate full order/fulfillment status views. Current order states cover pending/paid/failed/refunded, not the full print lifecycle.

**Phase C exit requires an actual sandbox purchase, verified replay/refund/expiry/provider-failure behavior and usable authorized delivery. Nothing here enables live charging.** See `COMMERCE_FOUNDATION.md` and `STRIPE_SANDBOX_ADAPTER.md` for exact contracts.

## Phase D — photography-specific workflows

### Implemented and locally verified

- Per-photo team/sport/opponent/date/venue/jersey/subject metadata and private photographer notes.
- Explicit owner approval for public search; public responses exclude notes/history/original keys and require public, published, password-free, ready, visible photos with both derivatives.
- Atomic version history, stale-edit protection and reversible restore-as-unapproved-draft. No automatic identification or facial search.
- Real local browser acceptance across owner sessions: save/reload, approval, edit de-approval, stale-draft retention, history restore, public search exclusion and responsive layouts. Ten SQL/HTTP/helper tests also cover access boundaries, concurrency, atomic rollback, bounded pagination and safe event reuse.
- Optional last-saved event reuse in the owner tab copies only team/sport/opponent/venue/date into an unsaved, unapproved draft; it preserves the target's jersey/subject/private notes and requires an explicit save. No server bulk-edit feature or automatic public approval is implied.
- Read-only Lightroom export/import-manifest preparation: signatures, size limits, checksums, duplicates, unstable-file detection and opt-in non-overwriting JSON output. Two dedicated tests pass.

### Remaining

- Private live metadata save/reload and exclusion from public search passed. Approved public-search acceptance and practical event/gallery-level defaults/bulk application remain; current metadata editing is per photo and search uses exact word tokens.
- Actual Lightroom integration or watched-folder publisher with durable queue, conflict handling, authenticated uploads and intentional publication. The manifest scanner does **not** watch, upload or publish.
- AI-assisted captions/keywords/jersey/subject suggestions with owner review, provenance and reversible approval; select the provider/workflow before external AI processing. No AI provider or face-identification service was connected.
- Strongest-first culling/review workflow beyond manual ordering and proof selection.
- Image provenance/export-protection metadata and any separately limited local protection tool; do not claim screenshots or AI removal can be prevented.
- QR event access, permission-scoped selected-image Quick Share and commercial licensing inquiry workflow.

## User input or external decisions still needed

The agent can continue code and local tests without repeated approval for ordinary in-scope work. These choices cannot be invented:

1. Which galleries/frames should actually be public, their cover/order/context and final portfolio copy; keep unrelated private images private.
2. Selling prices/packages/licenses, discount policy, digital download limits and print offerings; tax/shipping treatment and operational fulfillment rules.
3. Dedicated Stripe sandbox/account access if unavailable, then actual customer-style test completion when required. Live payments remain off until acceptance passes.
4. Any email/print/AI provider selections and account setup needed for those later features.
5. Production promotion and eventual domain cutover **only when the user is confident**; do not replace the current SmugMug domain as part of staging tests.

No extra subscription, provider purchase, invented business data or public-original permission is a prerequisite to honest progress on the code.
