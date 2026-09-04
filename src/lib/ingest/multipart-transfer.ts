import { z } from "zod";
import type { Sql } from "../db.ts";
import { createMultipartSessions } from "./multipart-session.ts";

export interface MultipartTransferStore {
  /** Must be idempotent for idempotencyKey. An ambiguous transport response must
   * be resolved to the same provider upload, never by creating another upload. */
  create(input: {
    idempotencyKey: string;
    objectKey: string;
    mime: "image/jpeg" | "image/png";
  }): Promise<{ uploadId: string }>;
  /** Must reject an attempt to reuse a part number with different bytes/checksum. */
  uploadPart(input: {
    uploadId: string;
    objectKey: string;
    number: number;
    bytes: Uint8Array;
    checksum: string;
  }): Promise<{ etag: string }>;
  /** Must make an ambiguous replay succeed by confirming the already-created immutable object. */
  complete(input: {
    uploadId: string;
    objectKey: string;
    parts: { number: number; etag: string }[];
  }): Promise<{ bytes: number; checksum: string }>;
  /** Idempotent: aborting an absent or already-aborted upload is successful. */
  abort(input: { uploadId: string; objectKey: string }): Promise<void>;
}
const id = z.string().trim().min(1).max(150);
const part = z
  .object({
    number: z.number().int().min(1).max(200),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.instanceof(Uint8Array),
  })
  .strict();
async function sha256(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function privateKey(uploadId: string) {
  return `catalog/quarantine/multipart/${uploadId}/original`;
}

/** Provider-neutral orchestration. This is server-only and intentionally has no
 * route. The storage adapter is responsible for provider-specific recovery. */
export function createMultipartTransfer(sql: Sql, store: MultipartTransferStore) {
  const sessions = createMultipartSessions(sql);
  return {
    async begin(owner: string, input: unknown) {
      const session = await sessions.declare(owner, input);
      if (session.status === "creating") {
        if (new Date(session.expiresAt).getTime() <= Date.now())
          throw new Error("Multipart upload expired");
        const key = privateKey(session.id);
        const provider = await store.create({
          idempotencyKey: session.id,
          objectKey: key,
          mime: session.mime as "image/jpeg" | "image/png",
        });
        await sessions.bindProvider(session.id, id.parse(provider.uploadId), key);
      }
      return sessions.resume(owner, session.id);
    },
    async uploadPart(owner: string, uploadId: string, input: unknown) {
      const data = part.parse(input);
      if (data.bytes.byteLength > 100 * 1024 * 1024 || (await sha256(data.bytes)) !== data.checksum)
        throw new Error("Multipart bytes do not match their checksum");
      const session = await sessions.resume(owner, uploadId);
      if (session.status !== "open") throw new Error("Multipart upload is not open");
      if (data.number > session.partCount) throw new Error("Invalid multipart part number");
      const expected =
        data.number === session.partCount
          ? session.bytes - session.partSize * (session.partCount - 1)
          : session.partSize;
      if (data.bytes.byteLength !== expected)
        throw new Error("Multipart part size does not match its declared position");
      const [identity] = await sql.query<{ provider_upload_id: string; object_key: string }>(
        `select provider_upload_id,object_key from catalog_multipart_uploads
        where id=$1 and owner_id=$2 and status='open' and expires_at>now()`,
        [id.parse(uploadId), id.parse(owner)],
      );
      if (!identity) throw new Error("Multipart upload unavailable");
      const uploaded = await store.uploadPart({
        uploadId: identity.provider_upload_id,
        objectKey: identity.object_key,
        number: data.number,
        bytes: data.bytes,
        checksum: data.checksum,
      });
      return sessions.recordPart(owner, uploadId, {
        number: data.number,
        bytes: data.bytes.byteLength,
        checksum: data.checksum,
        etag: z.string().min(1).max(512).parse(uploaded.etag),
      });
    },
    async complete(owner: string, uploadId: string) {
      const manifest = await sessions.prepareCommit(owner, uploadId);
      const result = await store.complete({
        uploadId: manifest.providerUploadId,
        objectKey: manifest.objectKey,
        parts: manifest.parts,
      });
      if (result.bytes !== manifest.bytes || result.checksum !== manifest.checksum)
        throw new Error("Completed multipart object failed integrity verification");
      await sessions.markCommitted(uploadId);
      return {
        id: uploadId,
        status: "committed" as const,
        bytes: manifest.bytes,
        checksum: manifest.checksum,
      };
    },
    async abort(owner: string, uploadId: string) {
      const cancelled = await sessions.cancel(owner, uploadId);
      if (cancelled.providerUploadId && cancelled.objectKey)
        await store.abort({ uploadId: cancelled.providerUploadId, objectKey: cancelled.objectKey });
      return { id: uploadId, status: "cancelled" as const };
    },
  };
}
