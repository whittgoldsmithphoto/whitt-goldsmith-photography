# Owner product pricing

Owner Selling → Pricing supports saved-product editing, individual digital products,
whole-gallery/album download products, and print variants with width, height, finish
and minimum DPI. Each print size/finish uses a separate product ID and independently
saved price. Select a saved price list/product to load its existing cents amount,
or use Edit price beside the saved amount. No price is invented or defaulted.

Prices remain integer USD cents; existing price lists, gallery overrides and discount
codes still apply. Changing a price does not rewrite prior quote/order snapshots.
Product kinds cannot be changed after creation. Create another product instead.

Migration 0020 adds gallery-download kind and print finish. Legacy incomplete print
rows are preserved for remediation, but new/updated prints require complete specs.
This migration does not enable print or gallery-download quoting or fulfillment.
The owner API rejects activation and the SQL quote function rejects both kinds even
if a product is activated outside the API. Digital-photo sandbox checkout is unchanged.

Confirmed owner decision: sales-tax registration scope is South Carolina only.
This is not a blanket tax exemption for other states or a restriction on buyer location.
No live tax setting or charge is activated by this pricing release.

Still to implement: gallery packaging/delivery, print-provider/shipping integration,
production Stripe/tax integration, durable reconciliation, and remaining provider tests.
This document does not certify live-payment readiness.

## Verification

2026-09-04: 352 tests passed on the complete Git snapshot with this change;
typecheck/build passed and lint had zero errors (six pre-existing warnings).
The real local authenticated browser harness created a print, changed its finish,
saved a price, reloaded it, checked database persistence, and denied a non-owner's
price mutation. Customer paid download/refund and organizer/resource browser checks
also passed. These local fixtures do not certify a printing provider.

Migration 0020 was applied transactionally to WGP Catalog Staging only, guarded by
the known staging fixture and migration 0019. Readback confirmed one migration row,
four retained photographs and one retained product. No existing product price or
live tax setting was changed.

Source `b713f92` deployed to staging Worker version
`2242cb90-5079-4bce-a059-dd6329d2c97b`. Signed-in browser readback confirmed all
three product choices, saved-price editing, print dimension/finish/DPI controls,
and disabled activation for prints. Public checkout remains disabled.
