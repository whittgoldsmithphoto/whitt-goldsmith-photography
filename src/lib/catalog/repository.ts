import { z } from "zod";
import type { Sql } from "../db.ts";
import type {
  CatalogGallery,
  CatalogPhoto,
  PublicCatalog,
  OwnerCatalog,
  GalleryInput,
  ReservationInput,
  PhotoInput,
} from "./types.ts";

import { CatalogError } from "./errors.ts";
import { createProofService } from "./proofs.ts";
import {
  claimMediaJobForPhoto,
  cancelMediaJobForPhoto,
  advanceMediaJobStage,
  enqueueMediaJob,
  failMediaJob,
} from "./media-jobs.ts";
import {
  DERIVATIVE_VARIANT_NAMES,
  MEDIA_VARIANT_NAMES,
  VARIANT_MAX_EDGE,
  derivativeVariantKey,
  fittedDimensions,
  type DerivativeVariantName,
} from "./media-variants.ts";
export { CatalogError } from "./errors.ts";
const DERIVATIVE_TRANSFORMATION_VERSION = 1;
const idSchema = z.string().uuid();
const gallerySchema = z
  .object({
    id: idSchema.optional(),
    revision: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(4000),
    customerInstructions: z.string().trim().max(4000).optional(),
    downloadPolicy: z.enum(["none", "purchased_only"]).optional(),
    category: z.string().trim().min(1).max(100),
    folderId: idSchema.nullable(),
    visibility: z.enum(["private", "public", "unlisted"]),
    published: z.boolean(),
    password: z.string().max(128).optional(),
    revokeAccess: z.boolean().optional(),
  })
  .strict();
const reservationSchema = z
  .object({
    galleryId: idSchema,
    filename: z.string().trim().min(1).max(255),
    mime: z.enum(["image/jpeg", "image/png"]),
    bytes: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: idSchema.optional(),
  })
  .strict();
export type GalleryRow = {
  id: string;
  folder_id: string | null;
  title: string;
  description: string;
  customer_instructions: string;
  download_policy: CatalogGallery["downloadPolicy"];
  category: string;
  visibility: CatalogGallery["visibility"];
  published: boolean;
  password_hash: string | null;
  access_version: number;
  revision: number;
  updated_at: string | Date;
};
export type PhotoRow = {
  caption: string;
  hidden: boolean;
  archived: boolean;
  display_order: number;
  revision: number;
  id: string;
  gallery_id: string;
  owner_id: string;
  filename: string;
  mime: string;
  bytes: number;
  checksum: string;
  original_key: string;
  status: string;
  error: string | null;
  width: number | null;
  height: number | null;
  updated_at: string | Date;
  reserved_until: string | Date;
};
export interface CatalogMedia {
  putOriginal(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  process(bytes: Uint8Array): Promise<{
    width: number;
    height: number;
    variants: Record<DerivativeVariantName, Uint8Array>;
  }>;
  putDerivative(key: string, bytes: Uint8Array): Promise<void>;
}
export async function digest(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
}
function quarantineOriginalKey(photoId: string, checksum: string) {
  return `catalog/quarantine/${photoId}/${checksum}`;
}
function trustedOriginalKey(photoId: string, checksum: string) {
  return `catalog/originals/${photoId}/${checksum}`;
}
async function passwordHash(password: string, salt: string = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return `${salt}:${Buffer.from(bits).toString("hex")}`;
}
async function passwordMatches(password: string, hash: string) {
  const candidate = await passwordHash(password, hash.split(":")[0]);
  let diff = candidate.length ^ hash.length;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ (candidate.charCodeAt(i) || 0);
  return diff === 0;
}
export function galleryView(row: GalleryRow): CatalogGallery {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    description: row.description,
    customerInstructions: row.customer_instructions ?? "",
    downloadPolicy: row.download_policy ?? "none",
    category: row.category,
    visibility: row.visibility,
    published: row.published,
    requiresPassword: Boolean(row.password_hash),
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
export function photoView(row: PhotoRow): CatalogPhoto {
  return {
    id: row.id,
    galleryId: row.gallery_id,
    filename: row.filename,
    caption: row.caption,
    width: row.width || 1,
    height: row.height || 1,
    src: `/api/catalog?op=media&id=${row.id}&kind=preview`,
    thumbSrc: `/api/catalog?op=media&id=${row.id}&kind=thumb`,
  };
}
export function createCatalog(sql: Sql, media: CatalogMedia) {
  async function audit(actor: string | null, action: string, target: string) {
    await sql`insert into catalog_audit(id,actor_id,action,target_id) values (${crypto.randomUUID()},${actor},${action},${target})`;
  }
  async function gallery(id: string) {
    if (!idSchema.safeParse(id).success) throw new CatalogError("Gallery unavailable", 404);
    const rows = await sql<GalleryRow>`select * from catalog_galleries where id=${id}`;
    if (!rows[0]) throw new CatalogError("Gallery unavailable", 404);
    return rows[0];
  }
  async function authorized(id: string, token?: string, owner = false) {
    const row = await gallery(id);
    if (owner) return row;
    if (!row.published || row.visibility === "private")
      throw new CatalogError("Gallery unavailable", 404);
    if (!row.password_hash) return row;
    if (token && token.length <= 100) {
      const hash = await digest(new TextEncoder().encode(token));
      const grants =
        await sql`select token_hash from catalog_access_grants where token_hash=${hash} and gallery_id=${id}
        and access_version=${row.access_version} and expires_at > now()`;
      if (grants.length) return row;
    }
    throw new CatalogError("Gallery password required", 401);
  }
  async function photos(id?: string, owner = false) {
    return id
      ? sql<PhotoRow>`select * from catalog_photos where gallery_id=${id} and status='ready'
          and (${owner} or (hidden=false and archived=false)) order by display_order,created_at,id`
      : sql<PhotoRow>`select p.* from catalog_photos p join catalog_galleries g on g.id=p.gallery_id
          where p.status='ready' and p.hidden=false and p.archived=false and g.published=true and g.visibility='public' and g.password_hash is null order by p.display_order,p.created_at,p.id`;
  }
  async function uploadOriginal(id: string, bytes: Uint8Array, owner: string) {
    const lease = crypto.randomUUID();
    const locked =
      await sql<PhotoRow>`update catalog_photos set status='uploading',operation_token=${lease},error=null,updated_at=now() where id=${id} and owner_id=${owner}
      and reserved_until>now() and (status in ('reserved','failed') or (status='uploading' and updated_at<now()-interval '5 minutes')) returning *`;
    const row = locked[0];
    if (!row) throw new CatalogError("Upload is unavailable, expired, or already received", 409);
    try {
      const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
      if (
        bytes.length !== row.bytes ||
        (await digest(bytes)) !== row.checksum ||
        !(row.mime === "image/jpeg" ? isJpeg : isPng)
      )
        throw new CatalogError("File does not match the reserved size, checksum, or image format");
      await media.putOriginal(row.original_key, bytes, row.mime);
      const completed =
        await sql`update catalog_photos set status='uploaded',updated_at=now() where id=${id} and operation_token=${lease} returning id`;
      if (!completed.length)
        throw new CatalogError("A newer upload attempt has taken over. Reload its status.", 409);
      const job = await enqueueMediaJob(sql, {
        photoId: id,
        ownerId: owner,
        transformationVersion: DERIVATIVE_TRANSFORMATION_VERSION,
      });
      await audit(owner, "upload.verified", id);
      return { id, status: "uploaded" as const, jobId: job.id };
    } catch (err) {
      await sql`update catalog_photos set status='failed',error=${err instanceof CatalogError ? err.message : "Storage failed. Retry the upload."},updated_at=now() where id=${id} and operation_token=${lease}`;
      throw err;
    }
  }
  return {
    ...createProofService(sql, authorized),
    authorizeGallery: authorized,
    async publicIndex(): Promise<PublicCatalog> {
      const rows =
        await sql<GalleryRow>`select * from catalog_galleries where published=true and visibility='public' and password_hash is null order by updated_at desc,id`;
      const folders = await sql<{
        id: string;
        parent_id: string | null;
        title: string;
      }>`with recursive visible_folders as (
        select f.* from catalog_folders f join catalog_galleries g on g.folder_id=f.id where g.published=true and g.visibility='public' and g.password_hash is null
        union select f.* from catalog_folders f join visible_folders v on v.parent_id=f.id
      ) select distinct id,parent_id,title from visible_folders`;
      return {
        galleries: rows.map(galleryView),
        photos: (await photos()).map(photoView),
        folders: folders.map((f) => ({ id: f.id, parentId: f.parent_id, title: f.title })),
      };
    },
    async detail(id: string, token?: string, owner = false) {
      const row = await authorized(id, token, owner);
      return { gallery: galleryView(row), photos: (await photos(id, owner)).map(photoView) };
    },
    async ownerIndex(): Promise<OwnerCatalog> {
      const galleries =
        await sql<GalleryRow>`select * from catalog_galleries order by updated_at desc,id`;
      const all =
        await sql<PhotoRow>`select * from catalog_photos order by display_order,created_at,id`;
      const folders = await sql<{
        id: string;
        parent_id: string | null;
        title: string;
      }>`select * from catalog_folders order by created_at,id`;
      const mediaJobRows = await sql<{
        photo_id: string;
        status: string;
        stage: string;
        progress_percent: number;
        error_message: string | null;
        updated_at: Date | string;
      }>`select photo_id,status,stage,progress_percent,error_message,updated_at
          from catalog_media_jobs job
          where transformation_version=(
            select max(newer.transformation_version) from catalog_media_jobs newer
            where newer.photo_id=job.photo_id and newer.kind=job.kind
          )`;
      const latestMediaJob = new Map<string, (typeof mediaJobRows)[number]>();
      for (const job of mediaJobRows)
        if (!latestMediaJob.has(job.photo_id)) latestMediaJob.set(job.photo_id, job);
      return {
        galleries: galleries.map(galleryView),
        photos: all
          .filter((p) => p.status === "ready")
          .map((p) => ({
            ...photoView(p),
            hidden: p.hidden,
            archived: p.archived,
            displayOrder: p.display_order,
            revision: p.revision,
          })),
        folders: folders.map((f) => ({ id: f.id, parentId: f.parent_id, title: f.title })),
        jobs: all.map((p) => {
          const mediaJob = latestMediaJob.get(p.id);
          return {
            id: p.id,
            galleryId: p.gallery_id,
            filename: p.filename,
            status: p.status,
            processingStatus: mediaJob?.status ?? null,
            processingStage: mediaJob?.stage ?? null,
            progressPercent: mediaJob?.progress_percent ?? (p.status === "ready" ? 100 : 0),
            error: mediaJob?.error_message ?? p.error,
            checksum: p.checksum,
            bytes: p.bytes,
            updatedAt: new Date(mediaJob?.updated_at ?? p.updated_at).toISOString(),
          };
        }),
      };
    },
    async savePhoto(raw: PhotoInput, owner: string) {
      const data = z
        .object({
          id: idSchema,
          revision: z.number().int().positive(),
          caption: z.string().trim().max(2000),
          hidden: z.boolean(),
          archived: z.boolean(),
          displayOrder: z.number().int().min(0).max(2147483647),
        })
        .strict()
        .parse(raw);
      // One statement keeps the optimistic update and its audit event atomic.
      const rows = await sql<PhotoRow>`with changed as (
        update catalog_photos set caption=${data.caption},hidden=${data.hidden},archived=${data.archived},
        display_order=${data.displayOrder},revision=revision+1,updated_at=now()
        where id=${data.id} and revision=${data.revision} and status='ready' returning *
      ), logged as (
        insert into catalog_audit(id,actor_id,action,target_id)
        select ${crypto.randomUUID()},${owner},'photo.updated',id from changed returning id
      ) select changed.* from changed cross join logged`;
      if (!rows[0])
        throw new CatalogError("Photo changed or is not ready. Reload before saving.", 409);
      const p = rows[0];
      return {
        ...photoView(p),
        hidden: p.hidden,
        archived: p.archived,
        displayOrder: p.display_order,
        revision: p.revision,
      };
    },
    async saveGallery(raw: GalleryInput, owner: string) {
      const data = gallerySchema.parse(raw);
      if (data.password && data.password.length < 10)
        throw new CatalogError("Use at least 10 characters for a gallery password");
      const hash =
        data.password === undefined
          ? undefined
          : data.password
            ? await passwordHash(data.password)
            : null;
      const id = data.id || crypto.randomUUID();
      if (data.published) {
        const ready = await photos(id);
        if (!ready.length)
          throw new CatalogError("Upload and process at least one photograph before publishing");
      }
      if (data.id) {
        const current = await gallery(id);
        const invalidate =
          hash !== undefined ||
          data.visibility !== current.visibility ||
          data.published !== current.published ||
          data.revokeAccess;
        const changed =
          await sql`update catalog_galleries set title=${data.title}, description=${data.description}, category=${data.category},
          folder_id=${data.folderId},visibility=${data.visibility},published=${data.published},password_hash=${hash === undefined ? current.password_hash : hash},
          customer_instructions=${data.customerInstructions ?? current.customer_instructions},download_policy=${data.downloadPolicy ?? current.download_policy},
          access_version=access_version+${invalidate ? 1 : 0},revision=revision+1,updated_at=now() where id=${id} and revision=${data.revision || 0} returning id`;
        if (!changed.length)
          throw new CatalogError(
            "This gallery changed on another device. Reload before saving.",
            409,
          );
      } else {
        await sql`insert into catalog_galleries(id,folder_id,title,description,category,visibility,published,password_hash,customer_instructions,download_policy)
          values(${id},${data.folderId},${data.title},${data.description},${data.category},${data.visibility},false,${hash || null},${data.customerInstructions ?? ""},${data.downloadPolicy ?? "none"})`;
      }
      await audit(owner, "gallery.saved", id);
      return galleryView(await gallery(id));
    },
    async createFolder(raw: { title: string; parentId: string | null }, owner: string) {
      const data = z
        .object({ title: z.string().trim().min(1).max(180), parentId: idSchema.nullable() })
        .strict()
        .parse(raw);
      const id = crypto.randomUUID();
      await sql`insert into catalog_folders(id,parent_id,title) values(${id},${data.parentId},${data.title})`;
      await audit(owner, "folder.created", id);
      return { id, ...data };
    },
    async unlock(id: string, password: string, clientBucket = "local") {
      const row = await gallery(id);
      if (!row.published || row.visibility === "private" || !row.password_hash)
        throw new CatalogError("Gallery unavailable", 404);
      if (typeof password !== "string" || password.length > 128)
        throw new CatalogError("Invalid password");
      // Per-client atomic bucket runs before the higher shared abuse ceiling.
      const client = await sql<{ attempts: number; allowed: boolean }>`
        insert into catalog_client_attempts(gallery_id,client_bucket,window_start)
        values(${id},${clientBucket},now())
        on conflict(gallery_id,client_bucket) do update set
          attempts=case when catalog_client_attempts.window_start < now()-interval '1 minute' then 1 else least(catalog_client_attempts.attempts+1,30) end,
          window_start=case when catalog_client_attempts.window_start < now()-interval '1 minute' then now() else catalog_client_attempts.window_start end,
          blocked_until=case when catalog_client_attempts.window_start < now()-interval '1 minute' then now()
            when catalog_client_attempts.attempts>=10 then now()+least(60,power(2,least(6,catalog_client_attempts.attempts-10))) * interval '1 second'
            else catalog_client_attempts.blocked_until end
        returning attempts,blocked_until<=now() as allowed`;
      if (!client[0].allowed || client[0].attempts > 10)
        throw new CatalogError("Too many attempts. Try again in a minute.", 429);
      const limit = await sql<{
        attempts: number;
      }>`insert into catalog_access_attempts(gallery_id,window_start) values(${id},date_trunc('minute',now()))
        on conflict(gallery_id,window_start) do update set attempts=catalog_access_attempts.attempts+1 returning attempts`;
      if (limit[0].attempts > 1000)
        throw new CatalogError("Too many attempts. Try again in a minute.", 429);
      if (!(await passwordMatches(password, row.password_hash))) {
        await audit(null, "gallery.unlock_failed", id);
        throw new CatalogError("Incorrect password", 401);
      }
      const token = crypto.randomUUID() + crypto.randomUUID();
      const hash = await digest(new TextEncoder().encode(token));
      await sql`insert into catalog_access_grants(token_hash,gallery_id,access_version,expires_at) values(${hash},${id},${row.access_version},now()+interval '8 hours')`;
      await audit(null, "gallery.unlocked", id);
      return token;
    },
    async reserve(raw: ReservationInput, owner: string) {
      const data = reservationSchema.parse(raw);
      await gallery(data.galleryId);
      const requestSignature = await digest(
        new TextEncoder().encode(
          [data.galleryId, data.filename, data.mime, data.bytes, data.checksum].join("\u0000"),
        ),
      );
      const replay = async () => {
        if (!data.idempotencyKey) return null;
        const sessions = await sql<{
          photo_id: string;
          owner_id: string;
          request_signature: string;
          expires_at: string | Date;
        }>`select photo_id,owner_id,request_signature,expires_at from catalog_upload_sessions
          where idempotency_key=${data.idempotencyKey}`;
        const session = sessions[0];
        if (!session) return null;
        if (session.owner_id !== owner)
          throw new CatalogError("Upload session is unavailable", 409);
        if (new Date(session.expires_at).getTime() <= Date.now())
          throw new CatalogError("Upload session expired. Start a new upload.", 409);
        if (session.request_signature !== requestSignature)
          throw new CatalogError("This idempotency key belongs to a different upload.", 409);
        const photos =
          await sql<PhotoRow>`select * from catalog_photos where id=${session.photo_id}`;
        if (!photos[0]) throw new CatalogError("Upload session is unavailable", 409);
        return photos[0];
      };
      const prior = await replay();
      if (prior) return { id: prior.id, status: prior.status, duplicate: true };
      const id = crypto.randomUUID();
      const rows =
        await sql<PhotoRow>`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key)
        values(${id},${data.galleryId},${owner},${data.filename},${data.mime},${data.bytes},${data.checksum},${quarantineOriginalKey(id, data.checksum)})
        on conflict(gallery_id,checksum) do nothing returning *`;
      let selected = rows[0];
      if (!selected) {
        const old =
          await sql<PhotoRow>`select * from catalog_photos where gallery_id=${data.galleryId} and checksum=${data.checksum}`;
        if (!old[0] || old[0].owner_id !== owner)
          throw new CatalogError("Upload reservation is unavailable", 409);
        if (["reserved", "failed"].includes(old[0].status)) {
          await sql`update catalog_photos set reserved_until=now()+interval '1 hour' where id=${old[0].id}`;
        }
        selected = old[0];
      }
      if (data.idempotencyKey) {
        await sql`insert into catalog_upload_sessions(idempotency_key,photo_id,owner_id,request_signature)
          values(${data.idempotencyKey},${selected.id},${owner},${requestSignature})
          on conflict(idempotency_key) do nothing`;
        const persisted = await replay();
        if (!persisted || persisted.id !== selected.id)
          throw new CatalogError("This idempotency key belongs to a different upload.", 409);
      }
      if (rows.length) await audit(owner, "upload.reserved", id);
      return { id: selected.id, status: selected.status, duplicate: !rows.length };
    },
    uploadOriginal,
    async cancelProcessing(id: string, owner: string) {
      if (!idSchema.safeParse(id).success || !(await cancelMediaJobForPhoto(sql, id, owner)))
        throw new CatalogError("Processing job is unavailable or already finished", 409);
      await audit(owner, "photo.processing_cancelled", id);
      return { id, status: "needs_review" as const };
    },
    async upload(id: string, bytes: Uint8Array, owner: string) {
      await uploadOriginal(id, bytes, owner);
      return this.process(id, owner);
    },
    async process(id: string, owner: string) {
      const lease = crypto.randomUUID();
      const rows =
        await sql<PhotoRow>`update catalog_photos set status='processing',operation_token=${lease},error=null,updated_at=now() where id=${id} and owner_id=${owner}
        and (status in ('uploaded','needs_review') or (status='processing' and updated_at<now()-interval '5 minutes')) returning *`;
      const row = rows[0];
      if (!row)
        throw new CatalogError(
          "Processing is already running or the original has not been uploaded",
          409,
        );
      await enqueueMediaJob(sql, {
        photoId: id,
        ownerId: owner,
        transformationVersion: DERIVATIVE_TRANSFORMATION_VERSION,
      });
      const job = await claimMediaJobForPhoto(sql, id, `catalog-request:${lease}`, 300);
      if (!job?.leaseToken) {
        await sql`update catalog_photos set status='needs_review',error='Processing is already claimed. Retry after its lease expires.',updated_at=now()
          where id=${id} and operation_token=${lease}`;
        throw new CatalogError("Processing is already running", 409);
      }
      try {
        const original = await media.get(row.original_key);
        if (original.length !== row.bytes || (await digest(original)) !== row.checksum)
          throw new Error("Original verification failed");
        if (!(await advanceMediaJobStage(sql, job.id, job.leaseToken, "metadata", 30)))
          throw new CatalogError(
            "A newer processing attempt has taken over. Reload its status.",
            409,
          );
        const output = await media.process(original);
        if (!(await advanceMediaJobStage(sql, job.id, job.leaseToken, "derivatives", 50)))
          throw new CatalogError(
            "A newer processing attempt has taken over. Reload its status.",
            409,
          );
        const storedVariants = new Map<DerivativeVariantName, { key: string; bytes: Uint8Array }>();
        for (const [variantIndex, kind] of DERIVATIVE_VARIANT_NAMES.entries()) {
          const bytes = output.variants[kind];
          if (!bytes?.length) throw new Error("Missing or empty derivative");
          const checksum = await digest(bytes);
          const key = derivativeVariantKey(id, kind, checksum, DERIVATIVE_TRANSFORMATION_VERSION);
          await media.putDerivative(key, bytes);
          const stored = await media.get(key);
          if ((await digest(stored)) !== checksum)
            throw new Error("Derivative verification failed");
          const dimensions = fittedDimensions(output.width, output.height, VARIANT_MAX_EDGE[kind]);
          await sql`insert into catalog_media_variants(photo_id,name,transformation_version,object_key,mime,bytes,checksum,width,height)
            select ${id},${kind},${DERIVATIVE_TRANSFORMATION_VERSION},${key},'image/jpeg',${bytes.length},${checksum},${dimensions.width},${dimensions.height}
            where exists(select 1 from catalog_photos where id=${id} and operation_token=${lease})
            on conflict(photo_id,name,transformation_version) do update set
              object_key=excluded.object_key,mime=excluded.mime,bytes=excluded.bytes,checksum=excluded.checksum,
              width=excluded.width,height=excluded.height,updated_at=now()`;
          storedVariants.set(kind, { key, bytes });
          if (
            !(await advanceMediaJobStage(
              sql,
              job.id,
              job.leaseToken,
              "derivatives",
              55 + Math.round(((variantIndex + 1) / DERIVATIVE_VARIANT_NAMES.length) * 35),
            ))
          )
            throw new CatalogError(
              "A newer processing attempt has taken over. Reload its status.",
              409,
            );
        }
        const promotedOriginalKey = row.original_key.startsWith("catalog/quarantine/")
          ? trustedOriginalKey(id, row.checksum)
          : row.original_key;
        if (promotedOriginalKey !== row.original_key) {
          await media.putOriginal(promotedOriginalKey, original, row.mime);
          const promoted = await media.get(promotedOriginalKey);
          if (promoted.length !== row.bytes || (await digest(promoted)) !== row.checksum)
            throw new Error("Promoted original verification failed");
        }
        await sql`insert into catalog_media_variants(photo_id,name,transformation_version,object_key,mime,bytes,checksum,width,height)
          select ${id},'original',${DERIVATIVE_TRANSFORMATION_VERSION},${promotedOriginalKey},${row.mime},${row.bytes},${row.checksum},${output.width},${output.height}
          where exists(select 1 from catalog_photos where id=${id} and operation_token=${lease})
          on conflict(photo_id,name,transformation_version) do update set
            object_key=excluded.object_key,mime=excluded.mime,bytes=excluded.bytes,checksum=excluded.checksum,
            width=excluded.width,height=excluded.height,updated_at=now()`;
        for (const [legacyKind, variantKind] of [
          ["preview", "display"],
          ["thumb", "thumbnail"],
        ] as const) {
          const variant = storedVariants.get(variantKind)!;
          await sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum)
            select ${id},${legacyKind},${variant.key},${variant.bytes.length},${await digest(variant.bytes)}
            where exists(select 1 from catalog_photos where id=${id} and operation_token=${lease})
            on conflict(photo_id,kind) do update set object_key=excluded.object_key,bytes=excluded.bytes,checksum=excluded.checksum`;
        }
        // Publish the photo and close its fenced job in one database statement.
        // A database interruption can therefore never leave a completed job
        // pointing at a photo that is still unavailable.
        const promotionAuditId = crypto.randomUUID();
        const readyAuditId = crypto.randomUUID();
        const completed = await sql`with completed_photo as (
          update catalog_photos set status='ready',original_key=${promotedOriginalKey},width=${output.width},height=${output.height},error=null,updated_at=now()
          where id=${id} and operation_token=${lease}
            and exists(select 1 from catalog_media_jobs where id=${job.id} and status='processing' and lease_token=${job.leaseToken})
            and (select count(*) from catalog_media_variants
              where photo_id=${id} and transformation_version=${DERIVATIVE_TRANSFORMATION_VERSION})=${MEDIA_VARIANT_NAMES.length}
          returning id
        ), logged_promotion as (
          insert into catalog_audit(id,actor_id,action,target_id)
          select ${promotionAuditId},${owner},'original.promoted',id from completed_photo
          where ${promotedOriginalKey !== row.original_key}
          returning id
        ), logged_ready as (
          insert into catalog_audit(id,actor_id,action,target_id)
          select ${readyAuditId},${owner},'photo.ready',id from completed_photo
          returning id
        ) update catalog_media_jobs set
          status='completed',lease_token=null,worker_id=null,leased_until=null,
          stage='ready',progress_percent=100,
          error_code=null,error_message=null,completed_at=now(),updated_at=now()
          where id=${job.id} and status='processing' and lease_token=${job.leaseToken}
            and exists(select 1 from completed_photo)
            and (${promotedOriginalKey === row.original_key} or exists(select 1 from logged_promotion))
            and exists(select 1 from logged_ready)
          returning id`;
        if (!completed.length)
          throw new CatalogError(
            "A newer processing attempt has taken over. Reload its status.",
            409,
          );
        return { id, status: "ready" };
      } catch (error) {
        if (error instanceof CatalogError) throw error;
        const recorded = await failMediaJob(
          sql,
          job.id,
          job.leaseToken,
          "derivative_processing_failed",
          "Original is durable; derivative processing must be retried.",
          Math.min(3600, 30 * 2 ** Math.max(0, job.attempts - 1)),
        );
        if (!recorded)
          throw new CatalogError(
            "A newer processing attempt has taken over. Reload its status.",
            409,
          );
        const failed =
          await sql`update catalog_photos set status='needs_review',error='Original stored. Preview processing failed or is not configured. Retry after checking the Images binding and watermark.',updated_at=now() where id=${id} and operation_token=${lease} returning id`;
        if (!failed.length)
          throw new CatalogError(
            "A newer processing attempt has taken over. Reload its status.",
            409,
          );
        return { id, status: "needs_review" };
      }
    },
    async media(id: string, kind: string, token?: string, owner = false) {
      if (!new Set<string>(["preview", "thumb", ...MEDIA_VARIANT_NAMES]).has(kind))
        throw new CatalogError("Image unavailable", 404);
      const rows = await sql<PhotoRow>`select * from catalog_photos where id=${id}`;
      const row = rows[0];
      if (!row) throw new CatalogError("Image unavailable", 404);
      await authorized(row.gallery_id, token, owner);
      if (!owner && (row.hidden || row.archived)) throw new CatalogError("Image unavailable", 404);
      if (kind === "original") {
        if (!owner) throw new CatalogError("Image unavailable", 404);
        return { bytes: await media.get(row.original_key), mime: row.mime };
      }
      if (row.status !== "ready") throw new CatalogError("Image unavailable", 404);
      const namedKind = kind === "preview" ? "display" : kind === "thumb" ? "thumbnail" : kind;
      const named = await sql<{ object_key: string; mime: string }>`select object_key,mime
        from catalog_media_variants where photo_id=${id} and name=${namedKind}
        order by transformation_version desc limit 1`;
      if (named[0]) return { bytes: await media.get(named[0].object_key), mime: named[0].mime };
      const derivative = await sql<{
        object_key: string;
      }>`select object_key from catalog_derivatives where photo_id=${id} and kind=${kind}`;
      if (!derivative[0]) throw new CatalogError("Image unavailable", 404);
      return { bytes: await media.get(derivative[0].object_key), mime: "image/jpeg" };
    },
    async photoGallery(id: string) {
      const rows = await sql<{
        gallery_id: string;
      }>`select gallery_id from catalog_photos where id=${id}`;
      return rows[0]?.gallery_id;
    },
  };
}
