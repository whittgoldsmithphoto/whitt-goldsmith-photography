import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
async function files(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(`${directory}/${entry.name}`) : `${directory}/${entry.name}`,
      ),
    )
  ).flat();
}
const manifest = await readFile(path.join(root, "docs/BACKEND_CAPABILITY_MANIFEST.md"), "utf8");

test("capability manifest inventories every migration including nested auth schema", async () => {
  const migrations = (await files("migrations")).filter((file) => file.endsWith(".sql"));
  assert.ok(migrations.length >= 15);
  for (const migration of migrations)
    assert.ok(manifest.includes(`\`${migration}\``), `Missing migration: ${migration}`);
});

test("capability manifest inventories every API route and legacy operation", async () => {
  const routes = (await files("src/routes/api")).filter((file) => /\.tsx?$/.test(file));
  for (const file of routes) {
    const source = await readFile(path.join(root, file), "utf8");
    const route = source.match(/createFileRoute\(["']([^"']+)["']\)/)?.[1];
    assert.ok(route, `Unrecognized API route declaration: ${file}`);
    assert.ok(manifest.includes(`\`${route}\``), `Missing route: ${route}`);
  }
  for (const [file, prefix] of [
    ["src/lib/catalog/http.server.ts", "catalog"],
    ["src/lib/catalog-commerce/http.ts", "commerce"],
    ["src/lib/sports/http.ts", "sports"],
  ]) {
    const source = await readFile(path.join(root, file), "utf8");
    const operations = [...source.matchAll(/\b(?:op|operation)\s*===\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    assert.ok(operations.length > 0, `Operation discovery failed: ${file}`);
    for (const op of new Set(operations))
      assert.ok(manifest.includes(`\`${prefix}:${op}\``), `Missing operation: ${prefix}:${op}`);
  }
});

test("manifest exposes capability statuses and central remaining-work index", () => {
  for (const status of ["shipped", "staging-gated", "planned", "deferred", "rejected"])
    assert.ok(manifest.includes(`\`${status}\``));
  assert.ok(manifest.includes("BACKEND_REVISION_REMAINING.md"));
});

test("wildcard catalog resource operations are documented beyond the catch-all route", async () => {
  const source = await readFile(path.join(root, "src/lib/catalog/resource-http.server.ts"), "utf8");
  const roots = [...source.matchAll(/path\[0\]\s*===\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  assert.ok(roots.length > 0, "Resource dispatcher changed; update operation discovery");
  for (const name of new Set(roots))
    assert.ok(manifest.includes(`\`/api/catalog/${name}\``), `Missing resource: ${name}`);
  for (const match of source.matchAll(/path\.join\(["']\/["']\)\s*===\s*["']([^"']+)["']/g))
    assert.ok(manifest.includes(`\`/api/catalog/${match[1]}\``), `Missing resource: ${match[1]}`);
  for (const match of source.matchAll(/path\[2\]\s*===\s*["']([^"']+)["']/g))
    assert.ok(
      manifest.includes(`\`/api/catalog/galleries/:id/${match[1]}\``),
      `Missing gallery operation: ${match[1]}`,
    );
});
