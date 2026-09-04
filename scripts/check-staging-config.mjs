import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function checkStagingConfig(config) {
  assert.equal(config.name, "wgp-catalog-staging", "Wrong deployment target");
  assert.deepEqual(
    config.hyperdrive,
    [{ binding: "HYPERDRIVE", id: "c9d803e0e964401298a952b85dd05af4" }],
    "Staging database binding required",
  );
  assert.deepEqual(
    config.r2_buckets,
    [{ binding: "CATALOG_BUCKET", bucket_name: "wgp-catalog-staging" }],
    "Staging bucket binding required",
  );
  assert.equal(config.images?.binding, "IMAGES");
  assert.deepEqual(
    config.queues,
    {
      producers: [{ binding: "MEDIA_QUEUE", queue: "wgp-media-staging" }],
      consumers: [
        {
          queue: "wgp-media-staging",
          max_batch_size: 1,
          max_batch_timeout: 5,
          max_retries: 5,
          retry_delay: 30,
          dead_letter_queue: "wgp-media-staging-dlq",
          max_concurrency: 2,
        },
      ],
    },
    "Staging media queue and dead-letter queue required",
  );
  assert.equal(config.vars?.CATALOG_ENV, "staging");
  assert.equal(config.vars?.VITE_AUTH_ENABLED, "true");
  assert.equal(config.vars?.CATALOG_LIVE_CHECKOUT_ENABLED, "false");
  assert.equal(config.vars?.CATALOG_LIVE_DOWNLOADS_ENABLED, "false");
  assert.ok(
    !config.routes?.length && !config.route,
    "Custom domains/routes are forbidden in staging",
  );
  for (const key of Object.keys(config.vars ?? {})) {
    assert.ok(
      !/SECRET|PASSWORD|TOKEN|DATABASE_URL|R2_ACCESS_KEY|R2_BUCKET|STRIPE/.test(key),
      "Unexpected sensitive/provider variable in build config",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkStagingConfig(JSON.parse(readFileSync("dist/server/wrangler.json", "utf8")));
  console.log(
    "Staging target, isolated database/storage/queue resources, auth flag and absence of custom routes verified. Runtime secrets and live connectivity still require verification.",
  );
}
