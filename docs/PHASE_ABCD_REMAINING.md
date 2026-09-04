# A–D roadmap: current status index

The active status and remaining-work lists have been consolidated to avoid conflicting checkpoints:

- [Backend capability manifest](BACKEND_CAPABILITY_MANIFEST.md): implemented, staging-gated, planned, deferred and rejected capabilities; owner/customer/provider trust boundaries and migration/API inventory.
- [Backend revision remaining work](BACKEND_REVISION_REMAINING.md): every numbered task in the September backend plan, original A–D/security carryovers, decisions, provider dependencies and required acceptance evidence.

The complete backend program is **not finished**, and source implementation does not establish live provider acceptance. Do not activate checkout, customer delivery, printing or production/custom-domain cutover based solely on passing local tests.

## Historical evidence, not duplicate status

- [A–D acceptance checkpoint](PHASE_ABCD_ACCEPTANCE.md): previously observed staging and local tests, with simulated/provider evidence distinguished.
- [Second security audit checkpoint](SECOND_AUDIT_SECURITY_STATUS.md): 0014/0015 application, hardening and signed negative Stripe test.
- [Initial catalog phase](CATALOG_PHASE_A.md) and [earlier execution notes](PLAN_EXECUTION_STATUS.md): historical implementation context; earlier missing-feature statements may have been superseded.
- [Commerce foundation](COMMERCE_FOUNDATION.md), [Stripe boundary](STRIPE_SANDBOX_ADAPTER.md), [protected delivery](PURCHASED_DOWNLOAD_DELIVERY.md), and [sports/import workflow](SPORTS_METADATA_AND_IMPORT.md): domain implementation detail, not independent declarations of launch readiness.

Previous versions of this checklist remain in Git history. The consolidation does not discard unfinished tasks; they are explicitly carried into the central remaining-work register.
