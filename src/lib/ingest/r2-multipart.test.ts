import assert from "node:assert/strict";
import test from "node:test";
import { createR2MultipartStore } from "./r2-multipart.ts";

test("R2 multipart adapter maps parts and verifies the completed object", async () => {
  const calls: string[] = [];
  const data = new TextEncoder().encode("complete");
  const upload = {
    uploadId: "opaque-upload",
    async uploadPart(number: number, bytes: Uint8Array) {
      calls.push(`part:${number}:${bytes.byteLength}`);
      return { etag: `etag-${number}` };
    },
    async complete(parts: { partNumber: number; etag: string }[]) {
      calls.push(`complete:${JSON.stringify(parts)}`);
    },
    async abort() {
      calls.push("abort");
    },
  };
  const bucket = {
    async createMultipartUpload(key: string) {
      calls.push(`create:${key}`);
      return upload;
    },
    resumeMultipartUpload(uploadId: string, key: string) {
      calls.push(`resume:${uploadId}:${key}`);
      return upload;
    },
    async get(key: string) {
      calls.push(`get:${key}`);
      return { arrayBuffer: async () => data.buffer };
    },
  };
  const store = createR2MultipartStore(bucket);
  assert.deepEqual(await store.create({ idempotencyKey: "i", objectKey: "o", mime: "image/jpeg" }), {
    uploadId: "opaque-upload",
  });
  assert.deepEqual(
    await store.uploadPart({ uploadId: "u", objectKey: "o", number: 1, bytes: data, checksum: "ignored" }),
    { etag: "etag-1" },
  );
  const complete = await store.complete({ uploadId: "u", objectKey: "o", parts: [{ number: 1, etag: "etag-1" }] });
  assert.equal(complete.bytes, data.byteLength);
  assert.match(complete.checksum, /^[a-f0-9]{64}$/);
  await store.abort({ uploadId: "u", objectKey: "o" });
  assert.deepEqual(calls, [
    "create:o",
    "resume:u:o",
    "part:1:8",
    "resume:u:o",
    'complete:[{"partNumber":1,"etag":"etag-1"}]',
    "get:o",
    "resume:u:o",
    "abort",
  ]);
});
