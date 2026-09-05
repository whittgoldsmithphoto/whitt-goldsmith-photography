import { createHash } from "node:crypto";

export interface StoredArchive {
  size: number;
  etag: string;
  body: ReadableStream<Uint8Array>;
}

/** Verify a private archive without buffering it. Reopen only that immutable
 * object version before consuming any customer allowance or sending bytes.
 */
export async function openVerifiedArchive(
  get: (key: string) => Promise<StoredArchive | null>,
  expected: { key: string; bytes: number; checksum: string },
): Promise<StoredArchive> {
  if (
    !/^catalog\/archives\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/.test(expected.key) ||
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes < 1 ||
    expected.bytes > 2 * 1024 ** 3 ||
    !/^[a-f0-9]{64}$/.test(expected.checksum)
  )
    throw new Error("Invalid archive reference");
  const object = await get(expected.key);
  if (!object) throw new Error("Archive unavailable");
  const hash = createHash("sha256");
  const reader = object.body.getReader();
  let length = 0;
  try {
    if (object.size !== expected.bytes || !object.etag)
      throw new Error("Archive metadata mismatch");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > expected.bytes) throw new Error("Archive exceeds expected size");
      hash.update(value);
    }
    if (length !== expected.bytes || hash.digest("hex") !== expected.checksum)
      throw new Error("Archive checksum mismatch");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const delivery = await get(expected.key);
  if (!delivery) throw new Error("Archive unavailable");
  if (delivery.size !== expected.bytes || delivery.etag !== object.etag) {
    await delivery.body.cancel();
    throw new Error("Archive changed during verification");
  }
  return delivery;
}
