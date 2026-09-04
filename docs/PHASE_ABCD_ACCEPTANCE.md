# A–D implementation and acceptance evidence

Recorded September 3, 2026 (EDT). Scope: review branch `audit/server-catalog`, isolated `wgp-catalog-staging` Worker and staging Neon/R2 resources. Production and the SmugMug domain are unchanged. This is an implementation increment, not a declaration that A–D or launch acceptance is complete.

## Live observations

- Applied staging migrations 0008–0010 in one guarded transaction. The SQL required the known private staging photograph and expected migration baseline, and refused already-applied batches. Neon listed all ten migration records afterward.
- Applied 0011–0012 in a second guarded transaction; Neon visibly listed all twelve migration names. This adds terminal session outcomes and gallery instructions/download policy, without enabling checkout or changing gallery publication.
- Deployed initial combined Worker version `ae977d91-3609-4039-a8f1-0999d01a067c`. Final release information is recorded below when verified.
- Owner signed in and opened the existing private, unpublished three-photo football gallery. All three photographs remained ready.
- Downloaded the **actually served** three 480px thumbnails and one 2000×1333 preview through the signed-in browser's observed page assets. `sharp.metadata()` found no EXIF, XMP, IPTC or ICC in any of the four responses. Earlier local comparisons showed identical decoded pixels before/after filtering. This verifies delivery sanitization, not a rewrite of old R2 objects.
- Visually inspected that real 2000px football preview: it decodes correctly, retains the frame, and has the supplied Whitt Goldsmith logo overlaid centrally. Watermark aesthetics still remain an owner preference, not proof that removal/screenshots are impossible.
- Created the `Football` folder through the owner UI. It remained present after reload.
- Saved team `CCES`, sport `Football`, opponent `St. Joes` to SWG01452.jpg as an **unapproved private metadata draft**. Reloading the page and reopening the photo retained those fields. No subject, jersey, event date or venue was invented.
- Selected the already-stored SWG01452.jpg through the new upload UI. Result: **0 ready / 0 awaiting / 1 already stored / 0 failed / 0 not started**. The gallery and upload history still contained the same three originals.
- Anonymous HTTP checks: owner catalog, folder tree, proof inbox and private sports metadata returned 401; private original owner URL returned 401; private preview returned 404. Sports search for CCES returned an empty list. Commerce status reported checkout unavailable and quote-only.
- Owner Selling page loaded real empty product/list/coupon/order state from the staging database. No prices or fictional orders were inserted. Its obsolete local-workspace warning was identified and removed in the final source.

## Local evidence

- Combined release snapshot initially passed **201 script tests + 81 TypeScript tests**, typechecking, lint (zero errors, six existing warnings), Cloudflare build and isolated-staging configuration guard. Later regression additions are included in the final run recorded below.
- Browser harnesses use real local HTTP routes, Better Auth sessions and PGlite. Proofing covers two customer sessions, owner review, stale writes, search/pagination, keyboard/focus, failed-preview retry and 375/768/1440 widths. Folder tests cover create/rename/reload/reparent and access denial. Sports tests cover save/reload, approval reset, stale edits/history, private-field exclusion and responsive search.
- Upload browser harness verifies partial failure, safe retry, duplicates and stop-after-current. Its transfer completion/image processing are **simulated**, not live R2 failure injection.
- Stripe adapter tests use real SDK/HMAC verification with **injected provider readbacks** and database state transitions. They are not Stripe sandbox purchases or real webhook deliveries.
- PostgreSQL concurrency logic uses atomic functions and explicit locks; PGlite serializes its engine. Independent live Neon contention remains unverified.
- Additional pricing browser acceptance covers actual local product/list/price/override/coupon writes, a $25.00 → $22.50 fixture coupon quote, disabled checkout, failed-load retry, failed-save draft retention and long-ID overflow at all three widths. Fixture prices were not inserted in staging.
- Dependency advisory audit was attempted but npm's registry audit endpoint returned HTTP 400/retirement errors. No clean vulnerability-audit result is claimed, and dependencies were not blindly upgraded.

## Preserved files and release method

The working directory already had unrelated deleted tracked stock assets and `scripts/grok-pwa-shared.d.mts`. Those deletions are excluded from this change, not silently restored or committed. The release snapshot starts from tracked HEAD files and overlays authored additions/modifications, retaining baseline assets exactly as they remain in Git. That complete snapshot is what is built/deployed/tested; the incomplete working directory is not described as independently green.

No original photos, watermark credentials, database connection strings, auth secrets or payment secrets are committed. Previous iterations remain in Git history; changes are pushed to the existing review branch without rewriting history or replacing `main`.

## Remaining acceptance

See `PHASE_ABCD_REMAINING.md` for the full checklist. In particular, public/password gallery and cross-device proof flows need deployment-level acceptance; the real supplied photos remain private. RAW/TIFF, true multipart/background processing, real payment-to-authorized-download delivery, prints and Lightroom/AI/QR workflows remain incomplete. Stripe checkout stays disabled. Do not promote production based only on this evidence.
