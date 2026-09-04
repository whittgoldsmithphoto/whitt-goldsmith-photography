import { z } from "zod";
import type { Sql } from "../db.ts";

const id = z.string().trim().min(1).max(150);
const declaration = z
  .object({
    galleryId: id,
    filename: z.string().trim().min(1).max(255),
    mime: z.enum(["image/jpeg", "image/png"]),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(1000 * 1024 * 1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
const part = z
  .object({
    number: z.number().int().min(1).max(200),
    bytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    etag: z.string().min(1).max(512),
  })
  .strict();
type Row = {
  id: string;
  owner_id: string;
  gallery_id: string;
  filename: string;
  mime: string;
  total_bytes: number;
  checksum: string;
  part_size: number;
  part_count: number;
  provider_upload_id: string | null;
  object_key: string | null;
  status: string;
  expires_at: string | Date;
};
function failure(message: string): never {
  throw new Error(message);
}
async function signature(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function view(row: Row, parts: { part_number: number; bytes: number }[] = []) {
  return {
    id: row.id,
    galleryId: row.gallery_id,
    filename: row.filename,
    mime: row.mime,
    bytes: row.total_bytes,
    checksum: row.checksum,
    partSize: row.part_size,
    partCount: row.part_count,
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    parts: parts.map((p) => ({ number: p.part_number, bytes: p.bytes })),
  };
}

/** Server-only persistence. Provider IDs, ETags and object keys are returned only
 * by explicitly internal lifecycle methods; never serialize those methods' results to a browser. */
export function createMultipartSessions(sql: Sql) {
  async function row(owner: string, uploadId: string, allowExpired = false) {
    const [result] = await sql.query<Row>(
      `select * from catalog_multipart_uploads where id=$1 and owner_id=$2`,
      [id.parse(uploadId), id.parse(owner)],
    );
    if (!result) failure("Multipart upload unavailable");
    if (!allowExpired && new Date(result.expires_at).getTime() <= Date.now())
      failure("Multipart upload expired");
    return result;
  }
  return {
    async declare(owner: string, input: unknown) {
      id.parse(owner);
      const data = declaration.parse(input),
        requestSignature = await signature(data);
      const existing = await sql.query<Row & { request_signature: string }>(
        `select * from catalog_multipart_uploads where idempotency_key=$1`,
        [data.idempotencyKey],
      );
      if (existing[0]) {
        if (existing[0].owner_id !== owner || existing[0].request_signature !== requestSignature)
          failure("This idempotency key belongs to a different upload");
        return view(existing[0]);
      }
      const partSize = 5 * 1024 * 1024,
        partCount = Math.ceil(data.bytes / partSize);
      const uploadId = crypto.randomUUID();
      await sql.query(
        `insert into catalog_multipart_uploads(id,idempotency_key,owner_id,gallery_id,filename,mime,total_bytes,
        checksum,request_signature,part_size,part_count) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict(idempotency_key) do nothing`,
        [
          uploadId,
          data.idempotencyKey,
          owner,
          data.galleryId,
          data.filename,
          data.mime,
          data.bytes,
          data.checksum,
          requestSignature,
          partSize,
          partCount,
        ],
      );
      const [saved] = await sql.query<Row & { request_signature: string }>(
        `select * from catalog_multipart_uploads where idempotency_key=$1`,
        [data.idempotencyKey],
      );
      if (!saved || saved.owner_id !== owner || saved.request_signature !== requestSignature)
        failure("This idempotency key belongs to a different upload");
      return view(saved);
    },
    /** Internal adapter binds the opaque provider identity once. */
    async bindProvider(uploadId: string, providerUploadId: string, objectKey: string) {
      const [saved] = await sql.query<Row>(
        `update catalog_multipart_uploads set provider_upload_id=$2,object_key=$3,status='open',updated_at=now()
        where id=$1 and status='creating' and expires_at>now() returning *`,
        [
          id.parse(uploadId),
          id.parse(providerUploadId),
          z.string().min(1).max(1000).parse(objectKey),
        ],
      );
      if (saved) return;
      const [existing] = await sql.query<Row>(
        `select * from catalog_multipart_uploads where id=$1`,
        [uploadId],
      );
      if (
        existing?.status === "open" &&
        existing.provider_upload_id === providerUploadId &&
        existing.object_key === objectKey
      )
        return;
      failure("Multipart upload is not creating");
    },
    async resume(owner: string, uploadId: string) {
      const saved = await row(owner, uploadId);
      const parts = await sql.query<{ part_number: number; bytes: number }>(
        `select part_number,bytes from catalog_multipart_parts where upload_id=$1 order by part_number`,
        [saved.id],
      );
      return view(saved, parts);
    },
    async recordPart(owner: string, uploadId: string, input: unknown) {
      const data = part.parse(input),
        saved = await row(owner, uploadId);
      if (saved.status !== "open") failure("Multipart upload is not open");
      if (data.number > saved.part_count) failure("Invalid multipart part number");
      const expected =
        data.number === saved.part_count
          ? saved.total_bytes - saved.part_size * (saved.part_count - 1)
          : saved.part_size;
      if (data.bytes !== expected)
        failure("Multipart part size does not match its declared position");
      await sql.query(
        `insert into catalog_multipart_parts(upload_id,part_number,bytes,checksum,provider_etag)
        values($1,$2,$3,$4,$5) on conflict(upload_id,part_number) do nothing`,
        [saved.id, data.number, data.bytes, data.checksum, data.etag],
      );
      const [recorded] = await sql.query<{
        part_number: number;
        bytes: number;
        checksum: string;
        provider_etag: string;
      }>(
        `select part_number,bytes,checksum,provider_etag from catalog_multipart_parts where upload_id=$1 and part_number=$2`,
        [saved.id, data.number],
      );
      if (
        !recorded ||
        recorded.bytes !== data.bytes ||
        recorded.checksum !== data.checksum ||
        recorded.provider_etag !== data.etag
      )
        failure("Multipart part replay does not match");
      return { number: recorded.part_number, bytes: recorded.bytes };
    },
    /** Internal result contains the provider completion manifest. */
    async prepareCommit(owner: string, uploadId: string) {
      let saved = await row(owner, uploadId);
      if (!["open", "committing"].includes(saved.status)) failure("Multipart upload cannot commit");
      const parts = await sql.query<{ part_number: number; bytes: number; provider_etag: string }>(
        `select part_number,bytes,provider_etag from catalog_multipart_parts where upload_id=$1 order by part_number`,
        [saved.id],
      );
      if (
        parts.length !== saved.part_count ||
        parts.reduce((n, p) => n + p.bytes, 0) !== saved.total_bytes ||
        parts.some((p, i) => p.part_number !== i + 1)
      )
        failure("Multipart upload is incomplete");
      if (saved.status === "open") {
        const [changed] = await sql.query<Row>(
          `update catalog_multipart_uploads set status='committing',updated_at=now()
          where id=$1 and owner_id=$2 and status='open' and expires_at>now() returning *`,
          [saved.id, owner],
        );
        if (!changed) failure("Multipart upload cannot commit");
        saved = changed;
      }
      return {
        uploadId: saved.id,
        providerUploadId: saved.provider_upload_id!,
        objectKey: saved.object_key!,
        checksum: saved.checksum,
        bytes: saved.total_bytes,
        parts: parts.map((p) => ({ number: p.part_number, etag: p.provider_etag })),
      };
    },
    async markCommitted(uploadId: string) {
      const [changed] = await sql.query<Row>(
        `update catalog_multipart_uploads set status='committed',updated_at=now()
        where id=$1 and status='committing' returning *`,
        [id.parse(uploadId)],
      );
      if (changed) return;
      const [saved] = await sql.query<Row>(`select * from catalog_multipart_uploads where id=$1`, [
        uploadId,
      ]);
      if (saved?.status !== "committed") failure("Multipart upload is not committing");
    },
    /** Internal result tells the provider adapter exactly what to abort. */
    async cancel(owner: string, uploadId: string) {
      let saved = await row(owner, uploadId, true);
      if (saved.status === "committed" || saved.status === "committing")
        failure("Multipart upload cannot be cancelled");
      if (saved.status !== "cancelled") {
        [saved] = await sql.query<Row>(
          `update catalog_multipart_uploads set status='cancelled',updated_at=now()
          where id=$1 and owner_id=$2 and status in ('creating','open') returning *`,
          [saved.id, owner],
        );
        if (!saved) failure("Multipart upload cannot be cancelled");
      }
      return {
        providerUploadId: saved.provider_upload_id,
        objectKey: saved.object_key,
        status: "cancelled" as const,
      };
    },
  };
}
