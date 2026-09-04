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
export { CatalogError } from "./errors.ts";
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
  })
  .strict();
type GalleryRow = {
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
type PhotoRow = {
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
  process(
    bytes: Uint8Array,
  ): Promise<{ width: number; height: number; preview: Uint8Array; thumb: Uint8Array }>;
  putDerivative(key: string, bytes: Uint8Array): Promise<void>;
}
export async function digest(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
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
function galleryView(row: GalleryRow): CatalogGallery {
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
function photoView(row: PhotoRow): CatalogPhoto {
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
  return {
    ...createProofService(sql, authorized),
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
        jobs: all.map((p) => ({
          id: p.id,
          galleryId: p.gallery_id,
          filename: p.filename,
          status: p.status,
          error: p.error,
          checksum: p.checksum,
          bytes: p.bytes,
          updatedAt: new Date(p.updated_at).toISOString(),
        })),
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
    async unlock(id: string, password: string) {
      const row = await gallery(id);
      if (!row.published || row.visibility === "private" || !row.password_hash)
        throw new CatalogError("Gallery unavailable", 404);
      if (typeof password !== "string" || password.length > 128)
        throw new CatalogError("Invalid password");
      // Shared database bucket: limits apply across Worker instances and rotating IPs.
      const limit = await sql<{
        attempts: number;
      }>`insert into catalog_access_attempts(gallery_id,window_start) values(${id},date_trunc('minute',now()))
        on conflict(gallery_id,window_start) do update set attempts=catalog_access_attempts.attempts+1 returning attempts`;
      if (limit[0].attempts > 10)
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
      const id = crypto.randomUUID();
      const rows =
        await sql<PhotoRow>`insert into catalog_photos(id,gallery_id,owner_id,filename,mime,bytes,checksum,original_key)
        values(${id},${data.galleryId},${owner},${data.filename},${data.mime},${data.bytes},${data.checksum},${`catalog/originals/${id}`})
        on conflict(gallery_id,checksum) do nothing returning *`;
      if (!rows.length) {
        const old =
          await sql<PhotoRow>`select * from catalog_photos where gallery_id=${data.galleryId} and checksum=${data.checksum}`;
        if (old[0].owner_id === owner && ["reserved", "failed"].includes(old[0].status)) {
          await sql`update catalog_photos set reserved_until=now()+interval '1 hour' where id=${old[0].id}`;
        }
        return { id: old[0].id, status: old[0].status, duplicate: true };
      }
      await audit(owner, "upload.reserved", id);
      return { id, status: "reserved", duplicate: false };
    },
    async upload(id: string, bytes: Uint8Array, owner: string) {
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
          throw new CatalogError(
            "File does not match the reserved size, checksum, or image format",
          );
        await media.putOriginal(row.original_key, bytes, row.mime);
        const completed =
          await sql`update catalog_photos set status='uploaded',updated_at=now() where id=${id} and operation_token=${lease} returning id`;
        if (!completed.length)
          throw new CatalogError("A newer upload attempt has taken over. Reload its status.", 409);
        await audit(owner, "upload.verified", id);
      } catch (err) {
        await sql`update catalog_photos set status='failed',error=${err instanceof CatalogError ? err.message : "Storage failed. Retry the upload."},updated_at=now() where id=${id} and operation_token=${lease}`;
        throw err;
      }
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
      try {
        const original = await media.get(row.original_key);
        if (original.length !== row.bytes || (await digest(original)) !== row.checksum)
          throw new Error("Original verification failed");
        const output = await media.process(original);
        for (const kind of ["preview", "thumb"] as const) {
          const bytes = output[kind];
          if (!bytes.length) throw new Error("Empty derivative");
          const checksum = await digest(bytes);
          const key = `catalog/derivatives/${id}/${kind}-${checksum}.jpg`;
          await media.putDerivative(key, bytes);
          const stored = await media.get(key);
          if ((await digest(stored)) !== checksum)
            throw new Error("Derivative verification failed");
          await sql`insert into catalog_derivatives(photo_id,kind,object_key,bytes,checksum) select ${id},${kind},${key},${bytes.length},${checksum}
            where exists(select 1 from catalog_photos where id=${id} and operation_token=${lease})
            on conflict(photo_id,kind) do update set object_key=excluded.object_key,bytes=excluded.bytes,checksum=excluded.checksum`;
        }
        const completed =
          await sql`update catalog_photos set status='ready',width=${output.width},height=${output.height},error=null,updated_at=now() where id=${id} and operation_token=${lease} returning id`;
        if (!completed.length)
          throw new CatalogError(
            "A newer processing attempt has taken over. Reload its status.",
            409,
          );
        await audit(owner, "photo.ready", id);
        return { id, status: "ready" };
      } catch (error) {
        if (error instanceof CatalogError) throw error;
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
      if (!["preview", "thumb", "original"].includes(kind))
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
