# Digital-only setup — September 4, 2026

The owner explicitly deferred prints and requested digital sales only. No tax registration was submitted and no blanket exemption was configured.

## Implemented and verified

- Removed the incorrect provider-preflight requirement that the Stripe account have at least one active tax registration. Empty registration lists no longer cause an unconditional checkout failure.
- Kept Stripe automatic tax, required billing addresses, the actual digital-product classification, account/mode validation, tax settlement verification, and independent live release/delivery gates. An unexpected registration outside the reviewed South Carolina scope still fails preflight pending review.
- Checkout accepts single-photo digital products only. Physical prints and unsupported gallery/album products are rejected server-side even if submitted directly.
- 364 automated tests pass in a complete release snapshot; production build/typecheck pass; lint has zero errors and six existing warnings. Added regression tests for empty registrations, tax configuration drift and non-photo product rejection.
- Deployed source version `95568a47-67ca-4f16-a3cd-5a170abbd326`; subsequent binding updates configure the exact production owner account, watermark key, and webhook gate. Customer checkout and downloads remain disabled.
- Verified the signed-in production Organizer after binding the owner's exact account ID. No first-visitor auto-promotion or email-verification flag changes were made.
- Authenticated diagnostics confirmed production Postgres, R2 Worker binding, Images, configured watermark and applied catalog migrations. A deployment had lost the watermark runtime variable; storing its object-key configuration as an encrypted binding repaired it. The webhook gate is also preserved as an encrypted binding. These non-secret values are not credentials.
- Created `CCES Football @ St. Joes` as a private draft with customer downloads disabled. No gallery was published.

## Tax boundaries

[SCDOR Revenue Ruling 15-10](https://dor.sc.gov/sites/dor/files/policies/RR15-10.pdf) distinguishes electronically delivered photographs from physical photographs and mixed physical/digital transactions. This is not a worldwide exemption and does not determine the owner's income-tax obligations.

[Stripe's zero-tax documentation](https://docs.stripe.com/tax/zero-tax) distinguishes an exempt product from `not_collecting` because no registration exists. A zero amount alone is not evidence that registration or collection was unnecessary. Customer geography and any obligations outside SC still need review before unrestricted public sales; no live tax/release acceptance flag was enabled by this change.

Actual production purchase, signed provider delivery, paid download and refund-revocation acceptance remain separate from automated fixture tests. Final customer prices/licenses must be approved through the owner UI before launch.
