import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArchiveEntries } from "./archive-safety.ts";

const entry = (path = "CCES/frame.jpg", extra: Partial<Record<string, unknown>> = {}) => ({
  path, compressedSize: 100, uncompressedSize: 100, kind: "file", type: "image/jpeg", ...extra,
});

test("accepts safe image entries and returns a folder manifest", () => {
  const result = validateArchiveEntries([entry("CCES\\frame.JPG")]);
  assert.equal(result.files[0].path, "CCES/frame.JPG");
  assert.equal(result.totalBytes, 100);
  assert.equal(result.compressedBytes, 100);
});

test("rejects traversal, symlink, directory, and encrypted entries", () => {
  for (const candidate of [
    entry("../frame.jpg"),
    entry("frame.jpg", { kind: "symlink" }),
    entry("frame.jpg", { kind: "directory" }),
    entry("frame.jpg", { externalAttributes: 0xa0000000 }),
    entry("frame.jpg", { flags: 1 }),
  ]) assert.throws(() => validateArchiveEntries([candidate]));
});

test("rejects compression bombs and archive budgets before extraction", () => {
  assert.throws(() => validateArchiveEntries([entry("frame.jpg", { compressedSize: 1, uncompressedSize: 101 })]), /compression/);
  assert.throws(() => validateArchiveEntries([entry("frame.jpg", { compressedSize: 0 })]), /compression/);
  assert.throws(() => validateArchiveEntries([entry("frame.jpg", { compressedSize: 101, uncompressedSize: 101 })], { maxArchiveBytes: 100 }), /compressed/);
  assert.throws(() => validateArchiveEntries([entry("frame.jpg", { uncompressedSize: 20 * 1024 * 1024 + 1 })]), /uncompressed/);
});

test("rejects malformed sizes, unsupported formats, and collisions", () => {
  for (const candidate of [entry("frame.gif", { type: "image/png" }), entry("frame.jpg", { compressedSize: -1 }), entry("frame.jpg", { uncompressedSize: 0 }), entry("frame.jpg", { compressedSize: Infinity })]) {
    assert.throws(() => validateArchiveEntries([candidate]));
  }
  assert.throws(() => validateArchiveEntries([entry("A.jpg"), entry("a.JPG")]));
});
