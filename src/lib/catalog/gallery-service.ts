import { z } from "zod";
import type { Sql } from "../db.ts";
import { pageInput, pageResult, encodeCursor } from "../api/pagination.ts";
import {
  CatalogError,
  galleryView,
  photoView,
  type GalleryRow,
  type PhotoRow,
} from "./repository.ts";
import type { CatalogGallery, CatalogPhoto } from "./types.ts";
export type GallerySummary = CatalogGallery & {
  cover: CatalogPhoto | null;
  coverPhotoId: string | null;
  photoCount: number;
  publishedAt: string | null;
};
type SummaryRow = GalleryRow & {
  cover: PhotoRow | null;
  photo_count: number;
  published_at: string | Date | null;
};
type Authorize = (id: string, token?: string, owner?: boolean) => Promise<GalleryRow>;
const visible =
  "p.status='ready' and not p.hidden and not p.archived and (select count(*) from catalog_derivatives d where d.photo_id=p.id)=2";
const publicGallery = "g.published and g.visibility='public' and g.password_hash is null";
export function createGalleryService(sql: Sql, authorize: Authorize) {
  return {
    async setCover(id: string, input: unknown, actor: string) {
      z.string().uuid().parse(id);
      const data = z
        .object({ photoId: z.string().uuid().nullable(), revision: z.number().int().positive() })
        .strict()
        .parse(input);
      const rows = await sql.query<GalleryRow>(
        `with changed as (
        update catalog_galleries g set cover_photo_id=$2,revision=g.revision+1,updated_at=now()
        where g.id=$1 and g.revision=$3 and ($2::text is null or exists(select 1 from catalog_photos p where p.id=$2 and p.gallery_id=g.id and ${visible})) returning g.*
      ), audit as (insert into catalog_audit(id,actor_id,action,target_id) select $4,$5,'gallery-cover',id from changed)
      select * from changed`,
        [id, data.photoId, data.revision, crypto.randomUUID(), actor],
      );
      if (!rows[0])
        throw new CatalogError(
          "Gallery changed or cover is unavailable; reload before retrying",
          409,
        );
      return galleryView(rows[0]);
    },
    async galleries(params: URLSearchParams, owner = false) {
      if (params.has("sort") && params.get("sort") !== "title")
        throw new CatalogError("Unsupported gallery sort");
      const folder = params.get("folder") || null,
        category = params.get("category") || null,
        q = params.get("q") || "";
      z.string().max(160).parse(q);
      z.string().max(100).nullable().parse(category);
      if (folder) z.string().uuid().parse(folder);
      const scope = JSON.stringify(["galleries", owner, folder, category, q]);
      const { limit, cursor } = pageInput(params, scope);
      if (cursor && typeof cursor.sort !== "string")
        throw new CatalogError("Invalid gallery cursor");
      const rows = await sql.query<SummaryRow>(
        `with recursive descendants as (
        select id from catalog_folders where id=$1 union select f.id from catalog_folders f join descendants d on f.parent_id=d.id
      ) select g.*, c.cover, (select count(*)::int from catalog_photos p where p.gallery_id=g.id and ${visible}) as photo_count
      from catalog_galleries g
      left join lateral (select row_to_json(p) as cover from catalog_photos p where p.gallery_id=g.id and ${visible}
        order by (p.id=g.cover_photo_id) desc nulls last,p.display_order,p.id limit 1) c on true
      where ($2::boolean or (${publicGallery})) and ($1::text is null or g.folder_id in(select id from descendants))
      and ($3::text is null or g.category=$3) and ($4='' or position(lower($4) in lower(g.title||' '||g.description||' '||g.category))>0)
      and ($5::text is null or (g.title,g.id)>($5,$6)) order by g.title,g.id limit $7`,
        [folder, owner, category, q, cursor?.sort ?? null, cursor?.id ?? null, limit + 1],
      );
      const result = pageResult(rows, limit, (row) =>
        encodeCursor({ scope, id: row.id, sort: row.title }),
      );
      return {
        ...result,
        data: result.data.map((row) => ({
          ...galleryView(row),
          cover: row.cover ? photoView(row.cover) : null,
          coverPhotoId: row.cover?.id ?? null,
          photoCount: row.photo_count,
          publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
        })),
      };
    },
    async detail(id: string, token?: string, owner = false) {
      return galleryView(await authorize(id, token, owner));
    },
    async photos(id: string, params: URLSearchParams, token?: string, owner = false) {
      const gallery = galleryView(await authorize(id, token, owner));
      if (params.has("sort") && params.get("sort") !== "order")
        throw new CatalogError("Unsupported photo sort");
      const scope = JSON.stringify(["photos", id, owner, "order"]),
        { limit, cursor } = pageInput(params, scope);
      if (cursor && typeof cursor.sort !== "number") throw new CatalogError("Invalid photo cursor");
      const rows = await sql.query<PhotoRow>(
        `select p.* from catalog_photos p where p.gallery_id=$1 and p.status='ready'
        and ($2::boolean or (${visible})) and ($3::integer is null or (p.display_order,p.id)>($3,$4))
        order by p.display_order,p.id limit $5`,
        [id, owner, cursor?.sort ?? null, cursor?.id ?? null, limit + 1],
      );
      const result = pageResult(rows, limit, (row) =>
        encodeCursor({ scope, id: row.id, sort: row.display_order }),
      );
      return { ...result, gallery, data: result.data.map(photoView) };
    },
    async library(params: URLSearchParams) {
      const q = z
          .string()
          .max(160)
          .parse(params.get("q") || ""),
        gallery = params.get("gallery") || null;
      if (gallery) z.string().uuid().parse(gallery);
      const scope = JSON.stringify(["library", q, gallery]),
        { limit, cursor } = pageInput(params, scope);
      const rows = await sql.query<PhotoRow>(
        `select p.* from catalog_photos p where ($1='' or position(lower($1) in lower(p.filename||' '||p.caption))>0)
        and ($2::text is null or p.gallery_id=$2) and ($3::text is null or p.id>$3) order by p.id limit $4`,
        [q, gallery, cursor?.id ?? null, limit + 1],
      );
      const result = pageResult(rows, limit, (row) => encodeCursor({ scope, id: row.id, sort: 0 }));
      return {
        ...result,
        data: result.data.map((row) => ({
          ...photoView(row),
          status: row.status,
          hidden: row.hidden,
          archived: row.archived,
          displayOrder: row.display_order,
          revision: row.revision,
        })),
      };
    },
    async folders(params: URLSearchParams, owner = false) {
      const scope = JSON.stringify(["folders", owner]),
        { limit, cursor } = pageInput(params, scope);
      const rows = await sql.query<{ id: string; parent_id: string | null; title: string }>(
        `with recursive visible as (
        select f.id,f.parent_id,f.title from catalog_folders f join catalog_galleries g on g.folder_id=f.id where ${publicGallery}
        union select f.id,f.parent_id,f.title from catalog_folders f join visible v on v.parent_id=f.id
      ) select f.id,f.parent_id,f.title from catalog_folders f where ($1::boolean or f.id in(select id from visible))
        and ($2::text is null or f.id>$2) order by f.id limit $3`,
        [owner, cursor?.id ?? null, limit + 1],
      );
      const result = pageResult(rows, limit, (row) => encodeCursor({ scope, id: row.id, sort: 0 }));
      return {
        ...result,
        data: result.data.map((f) => ({ id: f.id, parentId: f.parent_id, title: f.title })),
      };
    },
  };
}
