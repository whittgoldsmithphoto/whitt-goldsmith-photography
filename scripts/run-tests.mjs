import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
export function discoverTests(root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory()
        ? discoverTests(path)
        : /\.test\.(?:ts|mjs)$/.test(path)
          ? [path]
          : [];
    })
    .sort();
}
const files = [...discoverTests("scripts"), ...discoverTests("src")];
if (!files.length) throw new Error("No tests discovered");
console.log(`Discovered ${files.length} test files`);
const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
