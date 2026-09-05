import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openVerifiedArchive } from "./archive-delivery.ts";
const bytes = new Uint8Array([1, 2, 3]);
const expected = {
  key: "catalog/archives/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.zip",
  bytes: 3,
  checksum: createHash("sha256").update(bytes).digest("hex"),
};
function object(data = bytes, etag = "original", size = data.length) {
  return {
    size,
    etag,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(data);
        c.close();
      },
    }),
  };
}
test("archive delivery verifies bytes before returning the same stored version", async () => {
  let reads = 0;
  const result = await openVerifiedArchive(async () => {
    reads++;
    return object();
  }, expected);
  assert.equal(reads, 2);
  assert.deepEqual(new Uint8Array(await new Response(result.body).arrayBuffer()), bytes);
});
test("corrupt, oversized, missing and replaced archives never reach delivery", async () => {
  await assert.rejects(openVerifiedArchive(async () => null, expected));
  await assert.rejects(
    openVerifiedArchive(async () => object(new Uint8Array([3, 2, 1])), expected),
  );
  await assert.rejects(
    openVerifiedArchive(async () => object(new Uint8Array([1, 2, 3, 4]), "original", 3), expected),
  );
  let reads = 0;
  await assert.rejects(
    openVerifiedArchive(
      async () => object(bytes, ++reads === 1 ? "original" : "replacement"),
      expected,
    ),
  );
  await assert.rejects(
    openVerifiedArchive(async () => object(), { ...expected, key: "catalog/originals/private" }),
  );
});
