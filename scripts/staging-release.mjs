import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkStagingConfig } from "./check-staging-config.mjs";
import { stagingEnvironment } from "./staging-environment.mjs";
const mode = process.argv[2];
if (!["build", "verify", "deploy"].includes(mode))
  throw new Error("Explicit staging mode required");
function run(command, args) {
  // Generated config is already resolved. Passing CLOUDFLARE_ENV to Wrangler
  // would resolve it again and append a second '-staging' suffix.
  const buildOrDeploy = args[0] === "scripts/with-app-env.mjs";
  const env = stagingEnvironment(buildOrDeploy);
  if (buildOrDeploy) {
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    if (revision.status !== 0) throw new Error("Cannot identify release revision");
    env.VITE_BUILD_REVISION = revision.stdout.trim();
  }
  const r = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
run(process.execPath, ["scripts/with-app-env.mjs", "vite", "build", "--mode", "cloudflare"]);
checkStagingConfig(JSON.parse(readFileSync("dist/server/wrangler.json", "utf8")));
if (mode !== "build")
  for (const script of ["test", "typecheck", "lint"]) run("npm", ["run", script]);
if (mode === "deploy") {
  checkStagingConfig(JSON.parse(readFileSync("dist/server/wrangler.json", "utf8")));
  run("npx", [
    "--no-install",
    "wrangler",
    "deploy",
    "--name",
    "wgp-catalog-staging",
    "--env",
    "",
    "--keep-vars",
    "--config",
    "dist/server/wrangler.json",
  ]);
}
