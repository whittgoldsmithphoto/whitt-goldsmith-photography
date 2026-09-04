# Purchased original delivery — disabled sandbox endpoint

The customer original-delivery boundary is implemented at
`POST /api/commerce-download`, but is **off by default** and not production-ready
merely because its fixture tests pass. No actual purchase or Stripe acceptance is
claimed. No real originals were published by this implementation.

## Prerequisites

- Commerce migration `0008_commerce.sql`.
- Gallery policy migration `0012_gallery_customer_policy.sql`.
- Final download authorization migration
  `0013_customer_download_authorization.sql`.
- A genuinely paid local order and customer-bound entitlement.
- Current published gallery access, including a current password grant when
  applicable, and gallery `download_policy = purchased_only`.
- Ready, visible, unarchived photo and verified private R2 original.

Feature activation requires all three settings:

- `CATALOG_ENV=staging`
- `CATALOG_CUSTOMER_DOWNLOADS_ENABLED=true`
- `CATALOG_STRIPE_SANDBOX_ACCEPTED=true`

These flags are intentionally not set by tests or by this implementation. The
last flag is an operational acceptance gate, not evidence that a Stripe test
occurred. Production stays disabled regardless of the other flags.

## Client contract

All operations use same-origin JSON POST requests with the customer's existing
authenticated session. Request bodies are limited to 4 KiB. Query parameters are
rejected; do not place credentials or download tokens in URLs.

1. `{ "op": "list", "galleryId": "..." }` returns up to 100 eligible customer
   entitlements: entitlement ID, photo ID, filename and expiry. No object key.
2. `{ "op": "issue", "entitlementId": "..." }` returns a random opaque token and
   expiry in the response body. Issuing a replacement rotates the previous token.
   Only the token's SHA-256 hash is stored. The token also requires that same
   authenticated customer; it is not an anonymous bearer download link.
3. `{ "op": "deliver", "token": "..." }` returns the exact verified original
   as an attachment. Responses are private/no-store with nosniff and no-referrer.
   Filenames are sanitized for Content-Disposition; object keys never appear in
   response JSON, headers or redirects.

There is not yet a customer UI wired to this endpoint. Checkout remains disabled.

## Final authorization and attempt accounting

The server prechecks the paid entitlement and gallery access, then reads the
private native R2 object with a bounded reader. Object metadata size, stream size
and SHA-256 must match the stored record. Files above 20 MiB are rejected. Missing
or corrupt storage consumes **no download attempt** and returns no original.

After the bytes are verified, one PostgreSQL function locks the order and current
photo/gallery and checks the exact authorized gallery ID and revision, password
grant hash/version/expiry, current gallery policy, paid customer ownership,
entitlement token/expiry/revocation/use limit and immutable-object expectations.
Only then is one attempt reserved and an attachment response constructed.

This catches refund, policy changes, hidden/archive state, gallery moves,
password-grant expiry and token rotation occurring during storage readback.
Concurrent final-attempt requests cannot both succeed. A missing migration fails
closed with no attachment.

An attempt is a server delivery reservation, **not proof the browser received the
complete file**. If the client disconnects after final authorization, the attempt
still counts. Do not automatically refund an attempt after uncertain delivery;
owner-assisted retries and resumable delivery require a separate design.

Originals are delivered unchanged, including their original embedded metadata.
This differs from public watermarked previews, which strip location metadata.
Review the intended customer export/privacy policy before activating delivery.

## Verification

```
node --experimental-strip-types --test src/lib/catalog-commerce/customer-download.test.ts
```

Six PGlite/HTTP fixture tests cover auth/CSRF/body/query boundaries, unpaid denial,
byte-exact attachment delivery, privacy headers, customer scope, current access
and policy, token rotation/expiry/use caps, missing/corrupt storage, mid-read
refund/policy/hide/revision changes, grant expiry/version, gallery moves,
concurrent last-attempt behavior and missing-migration denial.

Runtime storage reuses `readVerifiedOriginal` from the independently tested
catalog-integrity service: native object size, bounded stream and checksum are
verified without an unbounded `arrayBuffer()` read.

Remaining acceptance: actual paid sandbox download through R2, client disconnects,
larger-file/resume handling, multi-connection PostgreSQL contention, and mobile
customer download UI. Fixture tests do not replace those checks.
