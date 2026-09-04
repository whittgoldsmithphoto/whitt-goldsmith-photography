# Backend resource budgets

These are regression budgets for the paginated resource service, not measured production availability or latency promises. The original aggregate compatibility endpoints are not covered by this benchmark and must not be described as bounded until callers migrate.

Run `node --experimental-strip-types scripts/catalog-load-baseline.mjs` from the repository. It creates an in-memory PGlite database with 100 synthetic galleries, 10,000 synthetic photos, and 20,000 derivative metadata records. No real photographs, network providers, existing database, or environment database URL is used. The command prints JSON. `--output new-file.json` writes an explicitly requested, previously nonexistent report file.

## Enforced budgets

- At most 50 items per response; index summaries contain at most one cover per gallery, never gallery contents.
- At most 51 SQL result rows per query (one extra row detects the next page).
- At most two SQL calls per measured first page, including gallery authorization.
- At most 128 KiB serialized JSON per synthetic-fixture response.
- No private original/derivative keys, checksums, password hashes, or operation tokens in measured responses.
- Cursor traversal returns all fixture galleries and library photos without duplicate IDs.

The test is automatically discovered by `npm test`. It measures actual service SQL through an instrumented adapter. Query count means database round trips, not internal subqueries or rows scanned by the PostgreSQL planner. The fixture therefore does not prove constant database work.

## Recorded, not promised

The report records first-page duration, serialized bytes, query count, largest result set, JavaScript heap change, and process resident memory for public index, gallery photos, and owner library. Heap changes can be negative due to garbage collection. Process memory includes the embedded database/WASM runtime, not only the request. Cold startup and fixture generation are excluded from request duration.

Do not set latency guarantees from one laptop run. Establish staging distributions over independent Neon connections and real network requests before setting p50/p95 latency objectives or production alerts. Public media authorization, API middleware, Cloudflare caching, R2 streaming, and browser rendering require separate acceptance tests. Normal original-download paths must stream rather than buffer whole originals; this metadata-only benchmark cannot verify that requirement.

## Remaining acceptance work

Upload summarized JSON as a CI artifact once the job is configured. Establish a comparable staging benchmark, migrate remaining aggregate clients, test concurrent mutation during traversal, measure response sizes with maximum allowed metadata strings, and add original-download memory tests. No synthetic metrics should appear as business activity in the owner dashboard.
