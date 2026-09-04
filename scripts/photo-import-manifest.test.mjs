import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createImportManifest,
  runImportManifest,
  MAX_IMPORT_BYTES,
} from "./photo-import-manifest.mjs";

test("manifest hashes supported files, detects duplicates and rejects unsupported/mismatched/empty/oversize files without mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wgp-import-test-"));
  try {
    const jpeg = Buffer.from([255, 216, 255, 1, 2, 3]);
    await writeFile(join(dir, "a.jpg"), jpeg);
    await writeFile(join(dir, "copy.JPG"), jpeg);
    await writeFile(join(dir, "fake.jpg"), "not a jpeg");
    await writeFile(join(dir, "empty.jpg"), "");
    await writeFile(join(dir, "raw.nef"), "RAW unsupported");
    await writeFile(join(dir, "large.jpg"), Buffer.alloc(MAX_IMPORT_BYTES + 1));
    await mkdir(join(dir, "nested"));
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    await writeFile(join(dir, "nested", "image.png"), png);
    await symlink(join(dir, "a.jpg"), join(dir, "linked.jpg"));
    const before = await stat(join(dir, "a.jpg"));
    const manifest = await createImportManifest(dir);
    assert.deepEqual(manifest.counts, {
      eligible: 2,
      duplicate: 1,
      unsupported: 2,
      rejected: 3,
      unstable: 0,
    });
    assert.equal(manifest.uploaded, false);
    const first = manifest.files.find((f) => f.path === "a.jpg");
    assert.equal(first.sha256, createHash("sha256").update(jpeg).digest("hex"));
    assert.equal(manifest.files.find((f) => f.path === "copy.JPG").duplicateOf, "a.jpg");
    assert.equal(manifest.files.find((f) => f.path === "nested/image.png").mime, "image/png");
    assert.deepEqual(await readFile(join(dir, "a.jpg")), jpeg);
    assert.equal((await stat(join(dir, "a.jpg"))).mtimeMs, before.mtimeMs);
    assert.ok(!JSON.stringify(manifest).includes(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("manifest output is opt-in exclusive JSON creation and cannot overwrite files or follow directory symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wgp-import-output-"));
  try {
    const source = join(dir, "source");
    await mkdir(source);
    const output = join(dir, "manifest.json");
    const json = await runImportManifest(["--source", source]);
    assert.equal(JSON.parse(json).uploaded, false);
    await assert.rejects(stat(output));
    await runImportManifest(["--source", source, "--output", output]);
    assert.equal(JSON.parse(await readFile(output, "utf8")).mode, "preparation-only");
    await assert.rejects(runImportManifest(["--source", source, "--output", output]), /EEXIST/);
    await assert.rejects(
      runImportManifest(["--source", source, "--output", join(dir, "photo.jpg")]),
      /new .json/,
    );
    await assert.rejects(runImportManifest(["--source", source, "--upload"]), /Usage/);
    const link = join(dir, "source-link");
    await symlink(source, link);
    await assert.rejects(createImportManifest(link), /symbolic link/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
