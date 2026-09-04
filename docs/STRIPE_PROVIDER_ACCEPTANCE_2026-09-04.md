# Deployed sandbox acceptance — 2026-09-04 UTC

Actual Stripe-hosted test payment and private Cloudflare R2 delivery passed on staging. This is not live-payment activation or full acceptance of every failure case.

## Evidence

- Worker: `wgp-catalog-staging.whittgoldsmithmedia.workers.dev`, source `38865c2`.
- Stripe sandbox: `acct_1UBQ7DDHsmsdTdeg`; checkout displayed Sandbox throughout. Used Stripe's 4242 test card, not real payment credentials.
- Synthetic gallery: `c4e58299-30fd-44f9-9781-86d3b40a4dc8`, unlisted, explicitly labeled PAYMENT TEST. Actual football photographs remained unpublished.
- Photo: `de9406a8-65f7-474c-b6e9-c493d43bba29`, `PAYMENT-TEST-NOT-FOR-SALE.png`. Owner upload reported ready with no failures.
- Separate non-default price list `sandbox-acceptance` and product `sandbox-test-original`: USD 100 cents; assigned only to the synthetic gallery.
- Quote: `41c1dc63-321a-4149-b2c9-31bd14e5e94b`.
- Order: `eeb109bc-d8d3-46d5-855d-0dcc339a1269`.
- Checkout Session: `cs_test_a11AvRx66gNcRa1cWerBLvzvfD3Iq42NtqXFhsC657QZzoi7sO8f5vuiYN`.
- PaymentIntent: `pi_3UBo5sDHsmsdTdeg0UhuuwCU`; charge `ch_3UBo5sDHsmsdTdeg0XaCiDYg`.
- `checkout.session.completed` event `evt_1UBo5tDHsmsdTdegOqyS6kk3` delivered to the named staging destination at 03:47:14 UTC. Stripe showed HTTP 200 and `{"received":true,"applied":"paid"}`. No SQL/manual paid-state mutation was used.
- Customer return page showed Paid and one original-download item. Download succeeded; allowance decreased from 10 to 9.
- SHA-256 of both uploaded fixture and browser-downloaded original: `c319afed632ba94da2dcd898c648dd5af2b4032fee23a2474f327b72cb8f97d1`.
- Full sandbox $1 refund submitted for this exact PaymentIntent; Stripe showed Refunded. Before refreshing the customer page, clicking its stale Download original button returned Download unavailable. Refresh showed Refunded with no download button. This denial occurred while download test flags were still enabled.
- A resend of the bound completed event was requested before refund. The displayed panel retained the original response, so this run does **not** claim independently confirmed replay delivery or database deduplication counts.

## Cleanup and boundaries

All five temporary staging gates were explicitly reset to `false` using successful Worker secret updates: `CATALOG_CHECKOUT_SANDBOX_ENABLED`, `CATALOG_CHECKOUT_DELIVERY_FIXTURE_ACCEPTED`, `CATALOG_CHECKOUT_TAX_FIXTURE_ACCEPTED`, `CATALOG_CUSTOMER_DOWNLOADS_ENABLED`, `CATALOG_STRIPE_SANDBOX_ACCEPTED`. The temporary tax flag enabled a zero-tax technical fixture only; it does not establish tax readiness.

Synthetic gallery/media, pricing and refunded order are retained as audit fixtures. No real charge, live refund, live secret change, custom-domain change or customer-photo publication occurred. Credentials were not added to this report or Git.

## Still not provider-verified

Independent replay readback/entitlement counts; declines and 3DS; delayed payment events; timeout recovery; cancellation/payment races; independent database contention; partial refunds and disputes; scheduled reconciliation; live tax and production configuration; account/payout readiness. Local fixture coverage is recorded separately and must not be substituted for these provider checks.

Browser issue: an inactive Dia Stripe tab rendered at zero width and hid responsive dialog buttons. Activating its visible tab in Dia restored the Refund confirmation button; this was a browser presentation issue, not a payment authorization failure.
