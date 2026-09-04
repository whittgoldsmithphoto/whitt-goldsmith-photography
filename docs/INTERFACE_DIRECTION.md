# Interface consolidation

Reference: Whitt's September 3 website style guide, used as direction rather than a replacement for working product behavior.

## Information architecture

- Public: Find your photos and About. Contact continues to use the verified Instagram route. No invented Portfolio collection or checkout link.
- Owner: Organizer, Proofs, Selling. A separate View site link returns to the customer surface.
- Organizer contains galleries, uploads, and the library. The old Upload and Library URLs still work, with Organizer highlighted; they are no longer duplicate navigation entries.
- Folder management is one disclosure; diagnostics, upload history, and file integrity are secondary tools. Active upload progress and errors remain visible.
- Selling contains Pricing, Discounts, Orders, and Test quote. Switching sections preserves unsaved form values. Checkout remains disabled.

Desktop uses a narrow owner sidebar. Mobile uses one opaque, dismissible navigation drawer. Public navigation never exposes owner destinations based solely on being signed in: the server capability check remains required. Route guards and backend permissions are unchanged.

## Visual direction

Charcoal surfaces, flat action blue, readable neutral text, serif public titles, and system sans-serif controls. Owner headings remain practical sans-serif. Gallery captions sit beneath photographs; proofing retains a predictable grid and explicit selected state. No stock photos, fabricated events, sales metrics, or published-photo changes.

The referenced electric-blue camera SVG was not included in this checkout or found alongside the supplied guide. A plain text wordmark is retained rather than inventing replacement artwork. Final logo placement and visual approval with a curated, approved public photo set remain separate steps.

## Verification

The browser integration harness covers the three owner destinations, closing mobile navigation, folder saves/reloads, pricing/discount/quote section switching, preserved form state, proof selection, and narrow layouts. Fixtures are synthetic and local; this is functional verification, not approval of photographic crops or a live Stripe checkout test.

Keep the custom domain on SmugMug and real galleries private until intentionally approved for publication. Review changes on staging before merging into main.
