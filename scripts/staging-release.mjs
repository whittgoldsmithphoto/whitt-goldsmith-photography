import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkStagingConfig } from "./check-staging-config.mjs";
import { stagingEnvironment } from "./staging-environment.mjs";
const mode = process.argv[2];
if (!["build", "verify", "deploy"].includes(mode))
  throw new Error("Explicit staging mode required");
if (mode === "deploy") {
  const clean = spawnSync("git", ["diff", "--quiet", "HEAD", "--"], { stdio: "inherit" });
  if (clean.status !== 0)
    throw new Error("Commit release changes or deploy from a clean worktree first.");
}
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
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const origin = "https://wgp-catalog-staging.whittgoldsmithmedia.workers.dev";
  const response = await fetch(origin, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok || response.headers.get("x-wgp-revision") !== revision)
    throw new Error(
      "Cloudflare did not serve the expected release revision. Deployment is not verified.",
    );
  const html = await response.text();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+\.(?:js|css))"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (!assets.length) throw new Error("Deployed page has no verifiable application assets.");
  await Promise.all(
    assets.map(async (path) => {
      const asset = await fetch(new URL(path, origin), {
        method: "HEAD",
        signal: AbortSignal.timeout(15000),
      });
      if (!asset.ok || /text\/html/.test(asset.headers.get("content-type") || ""))
        throw new Error(`Deployed application asset unavailable: ${path}`);
    }),
  );
  console.log(`Verified live revision ${revision} and ${assets.length} application assets.`);
}
