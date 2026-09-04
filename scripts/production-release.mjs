import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const mode = process.argv[2];
assert.ok(["build", "verify", "deploy"].includes(mode), "Explicit production mode required");
const env = { ...process.env };
delete env.CLOUDFLARE_ENV;
delete env.VITE_AUTH_ENABLED;
function run(command, args) {
  const result = spawnSync(command, args, {
    env: args[0] === "scripts/with-app-env.mjs" ? { ...env, VITE_AUTH_ENABLED: "true" } : env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ["scripts/with-app-env.mjs", "vite", "build", "--mode", "cloudflare"]);
const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
assert.equal(config.name, "whitt-goldsmith-photography");
assert.deepEqual(config.hyperdrive, [
  { binding: "HYPERDRIVE", id: "78c0c17c5ba844f4bb678dbbb1846311" },
]);
assert.deepEqual(config.r2_buckets, [
  { binding: "CATALOG_BUCKET", bucket_name: "whitt-goldsmith-photos" },
]);
assert.equal(config.vars.CATALOG_ENV, "production");
assert.equal(config.vars.VITE_AUTH_ENABLED, "true");
assert.equal(
  config.vars.BETTER_AUTH_URL,
  "https://whitt-goldsmith-photography.whittgoldsmithmedia.workers.dev",
);
assert.ok(!config.routes?.length && !config.route, "Do not change the SmugMug domain");
for (const key of [
  "CATALOG_LIVE_CHECKOUT_ENABLED",
  "CATALOG_LIVE_DOWNLOADS_ENABLED",
  "CATALOG_LIVE_WEBHOOK_ENABLED",
])
  assert.equal(config.vars[key], "false", "Release cannot implicitly enable sales");
if (mode !== "build")
  for (const script of ["test", "typecheck", "lint"]) run("npm", ["run", script]);
if (mode === "deploy") {
  assert.equal(
    process.env.WGP_PRODUCTION_MIGRATIONS_VERIFIED,
    "true",
    "Verify migrations and rollback before deploying",
  );
  run("npx", [
    "--no-install",
    "wrangler",
    "deploy",
    "--name",
    "whitt-goldsmith-photography",
    "--env",
    "",
    "--keep-vars",
    "--config",
    "dist/server/wrangler.json",
  ]);
}
