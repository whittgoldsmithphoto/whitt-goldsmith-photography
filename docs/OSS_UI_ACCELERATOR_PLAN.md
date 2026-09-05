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

## Deferred next slices

These remain in this plan so the branch can be compared honestly, but they are not prerequisites for the first pushed implementation:

1. Shared owner-resource query/cache to remove redundant capability/catalog calls.
2. Human-readable gallery/photo selectors throughout Selling and quote preview, based on Picstome workflow requirements but written independently.
3. Route-level lazy loading for owner, Stripe, diagnostics, migration, and legacy modules.
4. Canonical media assets plus multi-gallery memberships.
5. EXIF/IPTC/XMP metadata ingestion and indexed query grammar.
6. Smart collections and revision-safe bulk operations.
7. Invite-only proof rounds, guest comments, expiration, and notifications.
8. Explicit free/limited delivery grants and asynchronous ZIP fulfillment.

The larger data-model features require dedicated migrations and authorization matrices. They should not be rushed into a UI repair branch merely to increase feature count.
