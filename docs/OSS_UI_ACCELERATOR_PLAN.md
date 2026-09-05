# OSS gallery UI accelerator plan

**Branch:** `feature/oss-gallery-ui-accelerator`
**Base:** `2e3a14013da0e60f1fe796fcf862e563bb50410a` (`origin/backend/resource-foundation`)
**Safety:** This branch stays separate from `main`, `ui/consolidated-workspace`, and `backend/resource-foundation`. No deployment or merge is part of this plan.

## Product direction

The public site should feel like a restrained editorial sports-photography portfolio. Photographs and gallery titles carry the interface; controls stay quiet and specific. The owner workspace should feel like a dense photo desk: persistent context, compact filters, visible status, and no long jump between the selected photo and its controls.

Preserve the server-backed catalog, R2, auth, proofing, sports metadata, integrity, and commerce authorities. Do not reconnect the legacy browser-local store to production routes.

## Source boundaries

- **Lychee (MIT):** may donate behavior and small implementation patterns with notices preserved. Use its gallery browsing, metadata normalization, temporary-link, safe archive, and photo pipeline concepts selectively.
- **Picstome (AGPL-3.0; some Flux Pro commercial UI):** requirements and workflow reference only. Reimplement sharing, proofing, payment-status, and onboarding concepts independently in React/TypeScript. Do not copy PHP, Blade, Flux components, or assets.
- **Piwigo (GPL-2.0-or-later):** behavior and information-architecture reference only, especially batch management, categories, metadata, and derivatives.
- **PhotoPrism (AGPL-3.0):** behavior and visual-workflow reference only, especially filter-first search and media status. Its separately MIT-licensed vector algorithms are irrelevant to this UI phase.

## Findings to fix first

1. `/galleries` presents two disconnected search forms and leaves a large empty gap between them in an empty catalog.
2. Public gallery search requests on every keystroke.
3. `/about` waits on the gallery API even though its content is static.
4. Public request failures can expose raw backend messages and give weak retry guidance.
5. Gallery cards collapse when a cover is unavailable instead of preserving a photography-led grid.
6. Organizer photo editing appears below the entire grid, so the selected photo and its controls lose context.
7. Organizer has no client-side status filter or useful sort controls despite already loading authoritative photo records.
8. Selling asks the owner to paste gallery and photo IDs. This remains a later slice because it needs a shared owner-resource query rather than another duplicate catalog fetch.
9. The initial public JavaScript chunk exceeds 500 kB. Route-level splitting is a later performance slice after the UI contract stabilizes.

## Phase 1 — Public gallery discovery

Files:
- `src/components/catalog/public.tsx`
- `src/lib/sports/SportsSearch.tsx`
- `src/routes/galleries.index.tsx`
- `scripts/catalog-browser-check.mjs`

Changes:
- Add a dedicated static `AboutPage` that has no catalog request dependency.
- Make gallery-title search explicit-submit with a clear reset action; preserve current results while a new query is loading.
- Place gallery and approved sports-photo search in one bounded discovery region with a clear distinction between “events” and “individual photos.”
- Preserve a media aspect ratio for cover-pending galleries and label the state honestly.
- Replace customer-facing raw errors with safe copy and an actual retry button.
- Keep existing pagination, protected-gallery access, lightbox keyboard behavior, and public authorization boundaries.

Acceptance:
- RED browser checks prove About renders when catalog requests fail, filling the gallery field does not fetch until submit, both discovery modes share one region, and cover-pending cards retain a media area.
- Existing public catalog browser checks remain green at 375, 768, and 1440 px with no horizontal overflow or page errors.

## Phase 2 — Owner photo desk

Files:
- `src/components/catalog/organizer.tsx`
- `src/lib/catalog/organizer-photo-view.ts`
- `src/lib/catalog/organizer-photo-view.test.ts`
- `scripts/catalog-resource-browser-check.mjs`
- `src/styles.css` only if Tailwind utilities cannot express the responsive layout cleanly

Changes:
- Add real client-side filters for in-gallery, hidden, and archived photos.
- Add deterministic sorting by display order, filename, and newest update.
- Show count and current filter status without inventing data.
- Convert the selected-photo editor into a persistent right-hand inspector on wide screens and an in-flow panel on smaller screens.
- Keep cover selection, caption, display order, hide/archive, original download, sports metadata, and integrity controls connected to their existing APIs.
- Improve selected, hidden, archived, and cover visual states.
- Keep uploads, processing jobs, retries, cancellation, folders, and library search intact.

Acceptance:
- RED unit tests cover filter/sort behavior and stable tie-breaking.
- RED browser checks cover filtering, selecting a photo, keeping the filename visible in the inspector, and no overflow at 375/768/1440 px.
- Existing owner authorization, library pagination, cover mutation, CSRF denial, and revocation tests remain green.

## Phase 3 — Review and integration

- Exact-tip spec review against this plan.
- Quality/security review of changed files and authorization assumptions.
- Fix critical and important findings before integration.
- Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:dev`, both focused browser harnesses, and `node scripts/brand-check.mjs --placeholder-ok`.
- Capture fresh local desktop/mobile screenshots. Staging is comparison-only because this branch will not be deployed.

## Expanded OSS capability campaign

This follow-on branch is intentionally based on `feature/oss-gallery-ui-accelerator` and is published separately so the earlier implementation remains intact and can be compared directly. It treats the four projects as source-mapped references, not a license shortcut:

- **Lychee (MIT):** implementation-level patterns may inform safe archive handling, metadata normalization, temporary links, derivative pipelines, and gallery operations. Any copied implementation pattern must retain its MIT notice and be isolated from incompatible code.
- **Piwigo (GPL-2.0-or-later):** batch-manager, category/tree, metadata, derivative, and permission workflows are behavioral references only. Reimplement them in this repository's TypeScript/server authorities.
- **PhotoPrism (AGPL-3.0):** filter-first search, review/status vocabulary, duplicate-oriented workflows, and media lifecycle concepts are behavioral references only. Do not copy its application code or UI assets.
- **Picstome (AGPL-3.0, with separately restricted commercial UI pieces):** proofing, share/payment-status, client workflow, and onboarding concepts are product references only. Reimplement independently; do not copy PHP, Blade, Flux components, or assets.

The implementation order is deliberately vertical and fail-closed:

1. **Bulk photo workbench:** select visible/filtered photos, select all, clear selection, and apply real hide/unhide/archive/restore mutations through the existing revision-checked photo operation. This is the first expanded slice because it adds Piwigo/PhotoPrism leverage without a migration or a second data authority.
2. **Canonical memberships:** introduce an asset identity separate from gallery membership, preserve existing photo IDs and paid references, backfill/reconcile counts, and dual-read/write only after authorization and rollback tests exist. This is the prerequisite for true multi-gallery reuse.
3. **Metadata and smart collections:** add versioned EXIF/IPTC/XMP provenance, allowlisted indexed filters, saved searches, private previews, and revision-safe bulk metadata. Public responses must expose approved fields only.
4. **Sharing and proof rounds:** add scoped hashed invitations, guest binding, named proof rounds, expiration/revocation, comments, activity pagination, and outbox-backed notifications. Existing password grants remain compatibility paths until migration is accepted.
5. **Delivery and operations:** add explicit owner/free/limited/purchased grants, asynchronous immutable ZIP manifests, safe streamed extraction/recovery, bounded cleanup dry runs, derivative reconciliation, and truthful operator health.
6. **Performance and polish:** owner route code splitting, shared owner-resource caching, advanced search grammar, and mobile workflow refinement after the data contracts are stable.

Every slice must retain the existing catalog, R2, auth, integrity, proofing, sports, and commerce authorities. New controls must invoke a real action with readback/error handling; missing providers, decisions, and live acceptance remain explicit setup states. The branch will never activate payments, expose originals, or replace the earlier PR automatically.

## Expanded slice acceptance

- Focused RED → GREEN tests cover the new behavior and revision/error boundaries.
- Owner browser acceptance exercises the visible control against the real local server/PGlite path where the harness supports it; simulated media/provider paths are labeled.
- Full typecheck, lint, build, catalog/commerce/proof browser checks, responsive checks, brand check, dependency/security checks, and exact-tip spec/quality reviews run before publishing.
- GitHub publication uses a new branch and draft PR targeting the earlier accelerator branch or another explicitly selected base. Existing branches and PR #1 remain untouched.

The larger data-model features still require dedicated migrations and authorization matrices. They will be added in reviewable slices instead of being rushed into a UI repair branch merely to increase feature count.
