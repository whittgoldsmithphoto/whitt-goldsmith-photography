import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("large albums use a bounded queue CPU budget rather than frequent cron packaging", () => {
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  for (const target of [config, config.env.staging]) {
    assert.equal(target.limits.cpu_ms, 300000);
    assert.equal(target.queues.consumers[0].max_batch_size, 1);
    assert.equal(target.queues.consumers[0].max_concurrency, 2);
  }
  const source = readFileSync("src/server.ts", "utf8");
  assert.match(source, /processArchiveQueueBatch\(batch, processQueuedArchive\)/);
  assert.match(source, /await dispatchScheduledArchive\(\)/);
  assert.doesNotMatch(source.slice(source.indexOf("async scheduled()")), /processQueuedArchive\(/);
});
