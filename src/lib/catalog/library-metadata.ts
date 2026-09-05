import { z } from "zod";
import type { Sql } from "../db.ts";

const keyword = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((word) => word.normalize("NFKC").toLowerCase());
const words = z
  .array(keyword)
  .max(100)
  .transform((items) => [...new Set(items)].sort());
const label = z.enum(["", "select", "review", "reject"]);
export const libraryRules = z
  .object({
    q: z.string().max(200).optional(),
    keyword: keyword.optional(),
    rating: z.coerce.number().int().min(0).max(5).optional(),
    label: label.optional(),
    galleryId: z.string().min(1).max(200).optional(),
  })
  .strict();
const batch = z
  .object({
    photos: z
      .array(
        z.object({ id: z.string().min(1).max(200), revision: z.number().int().min(0) }).strict(),
      )
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((p) => p.id)).size === items.length),
    patch: z
      .object({
        addKeywords: words.optional(),
        removeKeywords: words.optional(),
        rating: z.number().int().min(0).max(5).optional(),
        label: label.optional(),
        privateNotes: z.string().max(4000).optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0),
  })
  .strict();
export interface LibraryMetadataRow {
  id: string;
  galleryId: string;
  filename: string;
  keywords: string[];
  rating: number;
  label: "" | "select" | "review" | "reject";
  privateNotes: string;
  revision: number;
}
/** Internal owner service. HTTP caller must enforce configured-owner identity.
 * No originals, storage keys or private annotations are added to public APIs. */
export function createLibraryMetadata(sql: Sql) {
  return {
    async bulk(input: unknown, actor: string) {
      const value = batch.parse(input);
      const [result] = await sql.query<{ changed: number }>(
        "select catalog_bulk_metadata($1::jsonb,$2::jsonb,$3) as changed",
        [JSON.stringify(value.photos), JSON.stringify(value.patch), actor],
      );
      return result;
    },
    async list(params: URLSearchParams) {
      const filters = libraryRules
        .extend({ q: z.string().max(200).default(""), after: z.string().max(200).default("") })
        .parse(Object.fromEntries(params));
      const rows = await sql.query<LibraryMetadataRow>(
        `select p.id,p.gallery_id as "galleryId",p.filename,
        coalesce(m.keywords,'{}') as keywords,coalesce(m.rating,0) as rating,coalesce(m.label,'') as label,
        coalesce(m.private_notes,'') as "privateNotes",coalesce(m.revision,0) as revision
        from catalog_photos p left join catalog_library_metadata m on m.photo_id=p.id
        where p.id>$1 and ($2='' or position(lower($2) in lower(p.filename||' '||p.caption))>0)
        and ($3::text is null or m.keywords @> array[$3::text])
        and ($4::integer is null or coalesce(m.rating,0)=$4)
        and ($5::text is null or coalesce(m.label,'')=$5)
        and ($6::text is null or p.gallery_id=$6)
        order by p.id limit 51`,
        [
          filters.after,
          filters.q,
          filters.keyword ?? null,
          filters.rating ?? null,
          filters.label ?? null,
          filters.galleryId ?? null,
        ],
      );
      return { items: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null };
    },
  };
}
