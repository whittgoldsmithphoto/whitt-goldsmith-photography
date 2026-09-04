import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFolderManifest } from "./folder-manifest.ts";

const file = (path = "CCES/Game/frame.jpg", size = 100) => ({ path, size, kind: "file", type: "image/jpeg" });
test("manifest normalizes browser separators and Unicode without changing source", () => {
  const input = [file("CCES\\Cafe\u0301\\frame.JPG")];
  const result = validateFolderManifest(input);
  assert.equal(result.files[0].path, "CCES/Café/frame.JPG");
  assert.equal(result.totalBytes, 100);
  assert.deepEqual(result.folders, ["CCES", "CCES/Café"]);
  assert.equal(input[0].path, "CCES\\Cafe\u0301\\frame.JPG");
  assert.ok(Object.isFrozen(result.files[0]));
});
test("manifest rejects unsafe or ambiguous paths", () => {
  for (const path of ["/a.jpg", "C:/a.jpg", "C:a.jpg", "\\\\server\\a.jpg", "../a.jpg", "x/../a.jpg", "./a.jpg", "x//a.jpg", "x/", "x/ a.jpg", "x/a.jpg ", "a\0.jpg", "a%2f.jpg", "x/a:b.jpg", "CON.jpg"]) {
    assert.throws(() => validateFolderManifest([file(path)]), Error, path);
  }
});
test("manifest rejects case and Unicode collisions and file-as-directory conflicts", () => {
  for (const paths of [["A.jpg", "a.JPG"], ["Café.jpg", "Cafe\u0301.jpg"], ["a.jpg", "a.jpg/b.jpg"], ["a.jpg/b.jpg", "a.jpg"]]) {
    assert.throws(() => validateFolderManifest(paths.map((path) => file(path))), /collision|directory/);
  }
});
test("manifest rejects unsupported content declarations and non-file nodes", () => {
  for (const entry of [{ ...file(), kind: "symlink" }, { ...file(), symlink: true }, { ...file(), linkTarget: "target" }, { ...file(), type: "text/html" }, file("a.zip"), file("a.raw"), { ...file(), size: 0 }, { ...file(), size: 1.5 }, { ...file(), size: Infinity }]) {
    assert.throws(() => validateFolderManifest([entry]));
  }
  assert.throws(() => validateFolderManifest({ files: [] }));
  assert.throws(() => validateFolderManifest([]));
});
test("manifest enforces all limits before constructing mappings", () => {
  assert.throws(() => validateFolderManifest([file()], { maxDepth: 1 }), /depth/);
  assert.throws(() => validateFolderManifest([file(), file("b.jpg")], { maxFiles: 1 }), /count/);
  assert.throws(() => validateFolderManifest([file()], { maxFileBytes: 99 }), /size/);
  assert.throws(() => validateFolderManifest([file(), file("b.jpg")], { maxTotalBytes: 199 }), /total/);
  assert.throws(() => validateFolderManifest([file()], { maxDepth: Infinity }), /limit/);
  assert.throws(() => validateFolderManifest([file("a".repeat(256) + ".jpg")]));
});
test("valid generated paths preserve independent entries within bounds", () => {
  const entries = Array.from({ length: 100 }, (_, i) => file(`event/folder${i % 10}/${i}.jpg`, i + 1));
  const result = validateFolderManifest(entries);
  assert.equal(result.files.length, 100);
  assert.equal(result.totalBytes, 5050);
  assert.equal(result.folders.length, 11);
});
