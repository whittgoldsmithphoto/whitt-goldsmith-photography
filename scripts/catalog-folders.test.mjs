import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("durable folder hierarchy integration", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "src/lib/catalog/folders.test.ts"],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /concurrent opposing moves/);
});
