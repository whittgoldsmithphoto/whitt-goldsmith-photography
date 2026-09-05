# September 5 repair checkpoint

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
