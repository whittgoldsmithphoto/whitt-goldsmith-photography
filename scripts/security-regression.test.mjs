import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stagingEnvironment } from "./staging-environment.mjs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("release commands cannot silently deploy the production default", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["build:cloudflare"], "npm run build:staging");
  assert.match(pkg.scripts["deploy:cloudflare"], /throw new Error/);
  const runner = read("scripts/staging-release.mjs");
  assert.match(runner, /stagingEnvironment/);
  assert.match(runner, /checkStagingConfig/);
  assert.match(runner, /--keep-vars/);
  assert.match(runner, /"--name",\s*"wgp-catalog-staging"/);
  assert.match(runner, /"--env",\s*""/);
});
test("resolved deployment config is never reinterpreted as another named environment", () => {
  const inherited = { CLOUDFLARE_ENV: "production", VITE_AUTH_ENABLED: "false", PATH: "fixture" };
  assert.equal(stagingEnvironment(true, inherited).CLOUDFLARE_ENV, "staging");
  assert.equal(stagingEnvironment(true, inherited).VITE_AUTH_ENABLED, "true");
  assert.equal(stagingEnvironment(false, inherited).CLOUDFLARE_ENV, undefined);
  assert.equal(stagingEnvironment(false, inherited).PATH, "fixture");
});
test("canonical test discovery covers both trees without an explicit TS allowlist", () => {
  assert.equal(JSON.parse(read("package.json")).scripts.test, "node scripts/run-tests.mjs");
  const runner = read("scripts/run-tests.mjs");
  assert.match(runner, /discoverTests\(['"]src/);
  assert.match(runner, /discoverTests\(['"]scripts/);
});
test("legacy download database function is retired without deleting entitlements", () => {
  const migration = read("migrations/0014_remove_legacy_download.sql");
  assert.match(migration, /DROP FUNCTION IF EXISTS commerce_reserve_download/);
  assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE/i);
});
