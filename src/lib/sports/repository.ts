import { z } from "zod";
import type { Sql } from "../db.ts";
import { CatalogError } from "../catalog/errors.ts";

const text = z.string().trim().max(160);
export const metadataSchema = z
  .object({
    photoId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    team: text,
    sport: text,
    opponent: text,
    eventDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const date = new Date(`${v}T00:00:00Z`);
        return (
          !v.startsWith("0000-") &&
          !Number.isNaN(date.valueOf()) &&
          date.toISOString().slice(0, 10) === v
        );
      }, "Invalid calendar date")
      .nullable(),
    venue: text,
    jerseyNumber: z
      .string()
      .trim()
      .max(12)
      .regex(/^[a-zA-Z0-9 -]*$/),
    subject: text,
    notes: z.string().trim().max(4000),
    approved: z.boolean(),
  })
  .strict();
export type SportsMetadata = z.infer<typeof metadataSchema>;
export type SportsSearchResult = {
  photoId: string;
  galleryId: string;
  galleryTitle: string;
  filename: string;
  team: string;
  sport: string;
  opponent: string;
  eventDate: string | null;
  venue: string;
  jerseyNumber: string;
  subject: string;
  thumbSrc: string;
};
type Row = {
  photo_id: string;
  team: string;
  sport: string;
  opponent: string;
  event_date: string | Date | null;
  venue: string;
  jersey_number: string;
  subject: string;
  notes: string;
  approved: boolean;
  revision: number;
};
export function emptyMetadata(photoId: string): SportsMetadata {
  return {
    photoId,
    revision: 0,
    team: "",
    sport: "",
    opponent: "",
    eventDate: null,
    venue: "",
    jerseyNumber: "",
    subject: "",
    notes: "",
    approved: false,
  };
}
function mapped(row: Row): SportsMetadata {
  return {
    photoId: row.photo_id,
    revision: row.revision,
    team: row.team,
    sport: row.sport,
    opponent: row.opponent,
    eventDate:
      row.event_date instanceof Date ? row.event_date.toISOString().slice(0, 10) : row.event_date,
    venue: row.venue,
    jerseyNumber: row.jersey_number,
    subject: row.subject,
    notes: row.notes,
    approved: row.approved,
  };
}
export function createSportsService(sql: Sql) {
  async function read(photoId: string) {
    z.string().uuid().parse(photoId);
    if (!(await sql`select id from catalog_photos where id = ${photoId}`).length)
      throw new CatalogError("Photo not found", 404);
    const rows = await sql<Row>`select * from sports_photo_metadata where photo_id = ${photoId}`;
    return rows[0] ? mapped(rows[0]) : emptyMetadata(photoId);
  }
  async function save(input: unknown, actorId: string) {
    const data = metadataSchema.parse(input);
    if (!actorId || actorId === "dev-user") throw new CatalogError("Owner required", 403);
    // One statement commits the versioned snapshot with the metadata update. Concurrent
    // edits cannot overwrite a newer revision or leave an unlogged successful edit.
    const rows = await sql<Row>`with changed as (
      insert into sports_photo_metadata(photo_id, team, sport, opponent, event_date, venue,
        jersey_number, subject, notes, approved, revision)
      select ${data.photoId}, ${data.team}, ${data.sport}, ${data.opponent}, ${data.eventDate}::date,
        ${data.venue}, ${data.jerseyNumber}, ${data.subject}, ${data.notes}, ${data.approved}, 1
      where exists(select 1 from catalog_photos where id = ${data.photoId})
        and (${data.revision} = 0 or exists(select 1 from sports_photo_metadata where photo_id = ${data.photoId}))
      on conflict(photo_id) do update set team = excluded.team, sport = excluded.sport,
        opponent = excluded.opponent, event_date = excluded.event_date, venue = excluded.venue,
        jersey_number = excluded.jersey_number, subject = excluded.subject, notes = excluded.notes,
        approved = excluded.approved, revision = sports_photo_metadata.revision + 1, updated_at = now()
      where sports_photo_metadata.revision = ${data.revision}
      returning *
    ), logged as (
      insert into sports_metadata_history(photo_id, revision, snapshot, actor_id)
      select photo_id, revision, to_jsonb(changed) - 'search_document', ${actorId} from changed
      returning photo_id
    ) select changed.* from changed join logged using(photo_id)`;
    if (!rows[0])
      throw new CatalogError("Photo missing or metadata changed. Reload before saving.", 409);
    return mapped(rows[0]);
  }
  async function history(photoId: string) {
    await read(photoId);
    const rows = await sql<{ snapshot: Row; created_at: string | Date }>`
      select snapshot, created_at from sports_metadata_history where photo_id = ${photoId}
      order by revision desc limit 50`;
    return rows.map((row) => ({ ...mapped(row.snapshot), savedAt: row.created_at }));
  }
  async function restore(input: unknown, actorId: string) {
    const data = z
      .object({
        photoId: z.string().uuid(),
        revision: z.number().int().positive(),
        restoreRevision: z.number().int().positive(),
      })
      .strict()
      .parse(input);
    const rows = await sql<{ snapshot: Row }>`select snapshot from sports_metadata_history
      where photo_id = ${data.photoId} and revision = ${data.restoreRevision}`;
    if (!rows[0]) throw new CatalogError("Saved revision not found", 404);
    // Restoring never silently republishes an old identification or tag approval.
    return save({ ...mapped(rows[0].snapshot), revision: data.revision, approved: false }, actorId);
  }
  async function search(input: unknown) {
    const data = z
      .object({
        query: z.string().trim().min(1).max(100),
        offset: z.number().int().min(0).max(1000).default(0),
      })
      .strict()
      .parse(input);
    const rows = await sql<Row & { gallery_id: string; gallery_title: string; filename: string }>`
      select m.photo_id, m.team, m.sport, m.opponent, m.event_date, m.venue, m.jersey_number,
        m.subject, p.gallery_id, g.title as gallery_title, p.filename
      from sports_photo_metadata m join catalog_photos p on p.id = m.photo_id
      join catalog_galleries g on g.id = p.gallery_id
      where m.approved and m.search_document @@ plainto_tsquery('simple', ${data.query})
        and g.published and g.visibility = 'public' and g.password_hash is null
        and p.status = 'ready' and not p.hidden and not p.archived
        and exists(select 1 from catalog_derivatives d where d.photo_id = p.id and d.kind = 'thumb')
        and exists(select 1 from catalog_derivatives d where d.photo_id = p.id and d.kind = 'preview')
      order by m.photo_id limit 25 offset ${data.offset}`;
    return {
      results: rows.map((row): SportsSearchResult => ({
        photoId: row.photo_id,
        galleryId: row.gallery_id,
        galleryTitle: row.gallery_title,
        filename: row.filename,
        team: row.team,
        sport: row.sport,
        opponent: row.opponent,
        eventDate:
          row.event_date instanceof Date
            ? row.event_date.toISOString().slice(0, 10)
            : row.event_date,
        venue: row.venue,
        jerseyNumber: row.jersey_number,
        subject: row.subject,
        thumbSrc: `/api/catalog?op=media&id=${encodeURIComponent(row.photo_id)}&kind=thumb`,
      })),
      nextOffset: rows.length === 25 && data.offset < 1000 ? data.offset + 25 : null,
    };
  }
  return { read, save, history, restore, search };
}
