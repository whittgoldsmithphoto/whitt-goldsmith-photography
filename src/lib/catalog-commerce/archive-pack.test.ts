import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { packPhotoArchive, type ArchiveEntry } from "./archive-pack.ts";

const bytes = new Uint8Array([255, 216, 255, 1, 2, 3]);
const checksum = createHash("sha256").update(bytes).digest("hex");
const entry = (id: string): ArchiveEntry => ({
  photoId: id,
  filename: "photo.jpg",
  objectKey: `private/${id}`,
  bytes: bytes.length,
  checksum,
});
function fixture(entries = [entry("a"), entry("b")]) {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let committed = false,
    aborted = false,
    checks = 0,
    writes = 0;
  const deps = {
    authorize: async () => {
      checks++;
    },
    read: async (_entry: ArchiveEntry) => new Blob([bytes]).stream(),
    openSink: async () => ({
      write: async (chunk: Uint8Array) => {
        writes++;
        chunks.push(chunk.slice());
      },
      commit: async () => {
        committed = true;
      },
      abort: async () => {
        aborted = true;
      },
    }),
  };
  return { entries, deps, chunks, state: () => ({ committed, aborted, checks, writes }) };
}
test("archive packer streams 500 snapshot originals with safe unique names", async () => {
  const f = fixture(Array.from({ length: 500 }, (_, i) => entry(`photo-${i}`)));
  const result = await packPhotoArchive(f.entries, f.deps);
  const archive = new Uint8Array(await new Blob(f.chunks).arrayBuffer());
  const files = unzipSync(archive);
  assert.equal(Object.keys(files).length, 500);
  assert.deepEqual(files["0001-photo.jpg"], bytes);
  assert.deepEqual(files["0500-photo.jpg"], bytes);
  assert.equal(result.bytes, archive.length);
  assert.equal(result.checksum, createHash("sha256").update(archive).digest("hex"));
  assert.equal(f.state().committed, true);
  assert.ok(f.state().checks >= 502);
});
test("archive refuses duplicate IDs, unsafe names and oversized manifests before storage", async () => {
  for (const entries of [
    [entry("a"), entry("a")],
    [{ ...entry("a"), filename: "../escape.jpg" }],
    Array.from({ length: 501 }, (_, i) => entry(String(i))),
    [{ ...entry("a"), bytes: 3 * 1024 ** 3 }],
  ]) {
    const f = fixture(entries);
    await assert.rejects(packPhotoArchive(entries, f.deps));
    assert.deepEqual(f.state(), { committed: false, aborted: false, checks: 0, writes: 0 });
  }
});
test("missing, truncated, oversized or corrupt originals abort without publishing a ZIP", async () => {
  for (const content of [null, bytes.slice(0, 3), new Uint8Array(7), new Uint8Array(6)]) {
    const f = fixture();
    await assert.rejects(
      packPhotoArchive(f.entries, {
        ...f.deps,
        read: async () => content && new Blob([content]).stream(),
      }),
    );
    assert.equal(f.state().committed, false);
    assert.equal(f.state().aborted, true);
  }
});
test("policy revocation during processing aborts before archive commit", async () => {
  const f = fixture();
  let count = 0;
  await assert.rejects(
    packPhotoArchive(f.entries, {
      ...f.deps,
      authorize: async () => {
        if (++count === 3) throw new Error("revoked");
      },
    }),
  );
  assert.equal(f.state().committed, false);
  assert.equal(f.state().aborted, true);
});
test("pre-cancelled jobs never open originals or storage", async () => {
  const f = fixture();
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(packPhotoArchive(f.entries, f.deps, stop.signal));
  assert.equal(f.state().writes, 0);
  assert.equal(f.state().committed, false);
});
