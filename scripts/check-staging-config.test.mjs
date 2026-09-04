import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStagingConfig } from "./check-staging-config.mjs";

const valid = () => ({
  name: "wgp-catalog-staging",
  hyperdrive: [{ binding: "HYPERDRIVE", id: "c9d803e0e964401298a952b85dd05af4" }],
  r2_buckets: [{ binding: "CATALOG_BUCKET", bucket_name: "wgp-catalog-staging" }],
  images: { binding: "IMAGES" },
  vars: { CATALOG_ENV: "staging", VITE_AUTH_ENABLED: "true" },
});
test("accepts isolated staging configuration", () => checkStagingConfig(valid()));
test("rejects production target, storage, database, routes and inline secrets", () => {
  for (const change of [
    { name: "whitt-goldsmith-photography" },
    { hyperdrive: [{ binding: "HYPERDRIVE", id: "78c0c17c5ba844f4bb678dbbb1846311" }] },
    { r2_buckets: [{ binding: "CATALOG_BUCKET", bucket_name: "whitt-goldsmith-photos" }] },
    { routes: ["example.com/*"] },
    { vars: { ...valid().vars, BETTER_AUTH_SECRET: "fixture" } },
    { vars: { ...valid().vars, VITE_AUTH_ENABLED: "false" } },
  ])
    assert.throws(() => checkStagingConfig({ ...valid(), ...change }));
});
