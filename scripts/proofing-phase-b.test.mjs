import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("Phase B real database proof inbox integration", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "src/lib/catalog/proofing-phase-b.test.ts"],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /proof inbox cursor, literal search/);
});
