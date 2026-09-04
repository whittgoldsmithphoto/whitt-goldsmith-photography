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

## Production photo acceptance follow-up

- Uploaded the three previously approved football JPEG samples through the authenticated production Organizer into the private draft. SWG01452.jpg and SWG01538.jpg reached `ready`; their displayed checksums match their local originals. Their thumbnails were visibly watermarked.
- Independently downloaded original `catalog/originals/1ac63315-ac4f-4a4c-8433-efb3ca84812c` from production R2. Its SHA-256 is `7a3957f4b901ce657796539a760a7178ea568e3212668fe2a3bbd748113aba93`, exactly matching local SWG01452.jpg.
- Anonymous original and owner-thumbnail requests return 401. Public catalog index remains empty. Live checkout remains unavailable; unsigned webhook POST returns 400.
- SWG03038.jpg initially outlived the upload request, but the saved processing state was recovered after its five-minute lease without creating a duplicate. It reached `ready`, and an independent R2 readback matched the local SHA-256 `78dfa549af3618ee5fb1f543a46716068dc60ed7b4c8ad2c4de20420643297ef` exactly. The owner retry action now also reconciles the visible batch row with the server result.
- Production Selling now contains the owner-approved $4.95 full-resolution digital-photo product and the license text “Licensed for personal and commercial use. Resale is not permitted.” Checkout and customer delivery remain disabled pending end-to-end live acceptance.
