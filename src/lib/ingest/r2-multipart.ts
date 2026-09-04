import type { MultipartTransferStore } from "./multipart-transfer.ts";

/** The small subset of Cloudflare's R2 binding used by the catalog.
 * Keeping this structural avoids importing worker-only globals in tests. */
export interface R2MultipartBinding {
  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2MultipartUpload>;
  resumeMultipartUpload(uploadId: string, key: string): R2MultipartUpload;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}
interface R2MultipartUpload {
  uploadId: string;
  uploadPart(partNumber: number, value: Uint8Array): Promise<{ etag: string }>;
  complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
  abort(): Promise<void>;
}

async function sha256(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Cloudflare R2 adapter. It is deliberately only constructible by the
 * staging route; callers never receive R2 upload IDs, keys, or ETags. */
export function createR2MultipartStore(bucket: R2MultipartBinding): MultipartTransferStore {
  return {
    async create({ idempotencyKey: _idempotencyKey, objectKey, mime }) {
      const upload = await bucket.createMultipartUpload(objectKey, {
        httpMetadata: { contentType: mime },
      });
      if (!upload.uploadId) throw new Error("R2 multipart upload did not return an ID");
      return { uploadId: upload.uploadId };
    },
    async uploadPart({ uploadId, objectKey, number, bytes }) {
      const uploaded = await bucket.resumeMultipartUpload(uploadId, objectKey).uploadPart(number, bytes);
      if (!uploaded?.etag) throw new Error("R2 multipart part did not return an ETag");
      return { etag: uploaded.etag };
    },
    async complete({ uploadId, objectKey, parts }) {
      await bucket.resumeMultipartUpload(uploadId, objectKey).complete(
        parts.map(({ number, etag }) => ({ partNumber: number, etag })),
      );
      const object = await bucket.get(objectKey);
      if (!object) throw new Error("R2 multipart object is missing after completion");
      const bytes = new Uint8Array(await object.arrayBuffer());
      return { bytes: bytes.byteLength, checksum: await sha256(bytes) };
    },
    async abort({ uploadId, objectKey }) {
      await bucket.resumeMultipartUpload(uploadId, objectKey).abort();
    },
  };
}
