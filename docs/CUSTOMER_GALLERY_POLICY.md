# Customer instructions and download policy

Migration `0012_gallery_customer_policy.sql` adds gallery-specific plain-text customer instructions (up to 4,000 characters) and a restrictive download-policy setting. Existing galleries default to empty instructions and `none`.

Owner gallery settings save these fields through the authenticated gallery endpoint and the same optimistic revision check as other gallery settings. Old clients that omit the fields preserve their existing values; an explicit empty instruction string clears the instructions. Instructions are rendered as text, not HTML, and appear only after the gallery's existing visibility/password authorization succeeds.

- `none`: customer downloads are not permitted by the declared gallery policy.
- `purchased_only`: the owner declares that a future customer delivery flow must require a confirmed purchase and valid entitlement. **This setting does not enable checkout or downloads.**

Neither setting grants access to originals, creates entitlements, bypasses a password, or introduces a public download URL. Owner-original access remains protected by the existing owner gate. Whole-gallery downloads remain unavailable.

Before enabling any customer download route, enforce the current gallery policy in the delivery authorization transaction, together with paid order state, customer identity, token scope, expiry, revocation, and download limits. The internal commerce entitlement primitives alone are not a completed customer delivery workflow.

Local verification: the catalog tests cover defaults, persisted edits, stale revisions, legacy-client preservation, validation, private-gallery secrecy, and original denial under both policies. The real local browser harness covers owner editing, public instruction readback, policy readback after reload, customer mutation denial, and anonymous original denial. These checks do not replace deployment/migration verification on staging.
