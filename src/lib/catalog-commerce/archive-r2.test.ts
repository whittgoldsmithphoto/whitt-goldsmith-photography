import { test } from "node:test";
import assert from "node:assert/strict";
import { openR2ArchiveSink, type ArchiveBucket } from "./archive-r2.ts";
const key =
  "catalog/archives/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.zip";
function fixture(corrupt = false) {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let complete = false,
    deleted = false,
    aborted = false;
  const bucket: ArchiveBucket = {
    createMultipartUpload: async () => ({
      uploadPart: async (_n, bytes) => {
        parts.push(bytes.slice());
        return { etag: String(parts.length) };
      },
      complete: async (uploaded) => {
        assert.equal(uploaded.length, parts.length);
        complete = true;
      },
      abort: async () => {
        aborted = true;
      },
    }),
    get: async () => {
      if (!complete) return null;
      const blob = new Blob(parts);
      return {
        size: blob.size,
        body: corrupt ? new Blob([new Uint8Array(blob.size)]).stream() : blob.stream(),
      };
    },
    delete: async (target) => {
      assert.equal(target, key);
      deleted = true;
    },
  };
  return { bucket, parts, state: () => ({ complete, deleted, aborted }) };
}
test("private R2 archive writer produces uniform multipart parts and verifies readback", async () => {
  const f = fixture();
  const sink = await openR2ArchiveSink(f.bucket, key);
  for (let i = 0; i < 35; i++) await sink.write(new Uint8Array(1024 * 1024).fill(i));
  await sink.commit();
  assert.deepEqual(
    f.parts.map((part) => part.length),
    [16, 16, 3].map((n) => n * 1024 * 1024),
  );
  assert.deepEqual(f.state(), { complete: true, deleted: false, aborted: false });
  await assert.rejects(sink.write(new Uint8Array([1])));
});
test("corrupt readback is rejected and only the generated archive is cleaned up", async () => {
  const f = fixture(true);
  const sink = await openR2ArchiveSink(f.bucket, key);
  await sink.write(new Uint8Array([1, 2, 3]));
  await assert.rejects(sink.commit(), /checksum/);
  await sink.abort();
  assert.equal(f.state().deleted, true);
});
test("archive sink rejects original or arbitrary keys without opening an upload", async () => {
  const f = fixture();
  await assert.rejects(openR2ArchiveSink(f.bucket, "catalog/originals/photo"));
  assert.equal(f.parts.length, 0);
});
