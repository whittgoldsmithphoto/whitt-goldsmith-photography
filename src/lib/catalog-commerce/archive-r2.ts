import { createHash } from "node:crypto";
import type { ArchiveSink } from "./archive-pack.ts";

interface Multipart {
  uploadPart(number: number, bytes: Uint8Array): Promise<{ etag: string }>;
  complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
  abort(): Promise<void>;
}
export interface ArchiveBucket {
  createMultipartUpload(
    key: string,
    options: { httpMetadata: { contentType: string } },
  ): Promise<Multipart>;
  get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array> } | null>;
  delete(key: string): Promise<void>;
}
const PART_SIZE = 5 * 1024 * 1024;

/** A fresh, random temporary key per attempt is required. Never pass an original
 * key here. Only private catalog/archives/<uuid>/<uuid>.zip is accepted.
 * Memory is bounded to one multipart part, independently of archive size.
 */
export async function openR2ArchiveSink(bucket: ArchiveBucket, key: string): Promise<ArchiveSink> {
  if (!/^catalog\/archives\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/.test(key))
    throw new Error("Invalid private archive destination");
  const existing = await bucket.get(key);
  if (existing) {
    await existing.body.cancel();
    throw new Error("Archive destination already exists");
  }
  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: "application/zip" },
  });
  let buffer = new Uint8Array(PART_SIZE),
    used = 0,
    total = 0,
    completed = false,
    closed = false;
  const hash = createHash("sha256");
  const parts: { partNumber: number; etag: string }[] = [];
  async function flush() {
    if (!used) return;
    const partNumber = parts.length + 1;
    const part = await upload.uploadPart(partNumber, buffer.subarray(0, used));
    if (!part.etag) throw new Error("Archive part was not confirmed");
    parts.push({ partNumber, etag: part.etag });
    // R2 has consumed the part after its promise resolves.
    buffer = new Uint8Array(PART_SIZE);
    used = 0;
  }
  return {
    async write(bytes) {
      if (closed) throw new Error("Archive sink is closed");
      total += bytes.length;
      if (total > 2 * 1024 ** 3) throw new Error("Archive exceeds size limit");
      hash.update(bytes);
      for (let offset = 0; offset < bytes.length;) {
        const length = Math.min(PART_SIZE - used, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + length), used);
        used += length;
        offset += length;
        if (used === PART_SIZE) await flush();
      }
    },
    async commit() {
      if (closed || !total) throw new Error("Archive sink cannot commit");
      await flush();
      await upload.complete(parts);
      completed = true;
      const object = await bucket.get(key);
      if (!object) throw new Error("Completed archive is missing");
      if (object.size !== total) {
        await object.body.cancel();
        throw new Error("Archive readback size mismatch");
      }
      const readHash = createHash("sha256"),
        reader = object.body.getReader();
      let read = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          read += value.length;
          if (read > total) throw new Error("Archive readback exceeds size");
          readHash.update(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (read !== total || readHash.digest("hex") !== hash.digest("hex"))
        throw new Error("Archive readback checksum mismatch");
      closed = true;
    },
    async abort() {
      closed = true;
      if (completed) await bucket.delete(key);
      else await upload.abort();
    },
  };
}
