import { z } from "zod";
import type { Sql } from "../db.ts";
import { CatalogError } from "./errors.ts";
import type { ProofInput, ProofSelection, OwnerProof } from "./types.ts";

type ProofRow = {
  id: string;
  gallery_id: string;
  note: string;
  revision: number;
  reviewed_revision: number;
  updated_at: string | Date;
};
type Access = (galleryId: string, token?: string) => Promise<{ access_version: number }>;
const schema = z
  .object({
    galleryId: z.string().uuid(),
    photoIds: z.array(z.string().uuid()).max(500),
    note: z.string().trim().max(2000),
    revision: z.number().int().min(0).max(2147483646),
  })
  .strict();
function customer(id: string) {
  if (!id || id === "dev-user") throw new CatalogError("Sign in to save your selection", 401);
}

export function createProofService(sql: Sql, access: Access) {
  async function readProof(
    galleryId: string,
    customerId: string,
    token?: string,
  ): Promise<ProofSelection> {
    customer(customerId);
    await access(galleryId, token);
    const rows =
      await sql<ProofRow>`select * from catalog_proofs where gallery_id=${galleryId} and customer_id=${customerId}`;
    const row = rows[0];
    if (!row)
      return {
        id: null,
        galleryId,
        photoIds: [],
        note: "",
        revision: 0,
        updatedAt: null,
        unavailableCount: 0,
      };
    // Do not leak metadata for photographs hidden or archived after selection.
    const items = await sql<{ photo_id: string; available: boolean }>`select i.photo_id,
      (p.status='ready' and p.hidden=false and p.archived=false and p.gallery_id=${galleryId}) as available
      from catalog_proof_items i join catalog_photos p on p.id=i.photo_id where i.proof_id=${row.id} order by p.display_order,p.created_at,p.id`;
    return {
      id: row.id,
      galleryId,
      note: row.note,
      revision: row.revision,
      updatedAt: new Date(row.updated_at).toISOString(),
      photoIds: items.filter((p) => p.available).map((p) => p.photo_id),
      unavailableCount: items.filter((p) => !p.available).length,
    };
  }
  return {
    readProof,
    async saveProof(raw: ProofInput, customerId: string, token?: string) {
      customer(customerId);
      const data = schema.parse(raw);
      if (new Set(data.photoIds).size !== data.photoIds.length)
        throw new CatalogError("Duplicate photograph selections");
      const gallery = await access(data.galleryId, token);
      const ids = JSON.stringify(data.photoIds);
      // Short atomic statement: validate current gallery version and visible photos,
      // CAS the list revision, replace membership, and record the owner notification.
      const changed = await sql<{ id: string }>`with requested as (
        select jsonb_array_elements_text(${ids}::jsonb) as id
      ), valid as (
        select id from catalog_photos where gallery_id=${data.galleryId} and status='ready'
          and hidden=false and archived=false and id in (select id from requested)
      ), saved as (
        insert into catalog_proofs(id,gallery_id,customer_id,note)
        select ${crypto.randomUUID()},${data.galleryId},${customerId},${data.note}
        where (select count(*) from valid)=${data.photoIds.length}
          and exists(select 1 from catalog_galleries where id=${data.galleryId}
            and access_version=${gallery.access_version} and published=true and visibility<>'private')
          and (${data.revision}=0 or exists(select 1 from catalog_proofs where gallery_id=${data.galleryId} and customer_id=${customerId}))
        on conflict(gallery_id,customer_id) do update set note=excluded.note,
          revision=catalog_proofs.revision+1,updated_at=now()
          where catalog_proofs.revision=${data.revision}
        returning id
      ), removed as (
        delete from catalog_proof_items where proof_id in (select id from saved)
          and photo_id not in (select id from requested) returning photo_id
      ), added as (
        insert into catalog_proof_items(proof_id,photo_id)
          select saved.id,requested.id from saved cross join requested
          on conflict(proof_id,photo_id) do nothing returning photo_id
      ), logged as (
        insert into catalog_audit(id,actor_id,action,target_id)
          select ${crypto.randomUUID()},${customerId},'proof.updated',id from saved returning id
      ) select saved.id from saved cross join logged`;
      if (!changed.length)
        throw new CatalogError(
          "Selection or gallery changed. Reload before saving; your draft has not been saved.",
          409,
        );
      return readProof(data.galleryId, customerId, token);
    },
    async ownerProofs(): Promise<OwnerProof[]> {
      // Bounded inbox; pagination is explicit, not an unbounded dashboard query.
      const rows = await sql<
        ProofRow & { gallery_title: string }
      >`select p.*,g.title as gallery_title
        from catalog_proofs p join catalog_galleries g on g.id=p.gallery_id
        order by p.updated_at desc,p.id limit 100`;
      const ids = JSON.stringify(rows.map((p) => p.id));
      const items = await sql<{
        proof_id: string;
        id: string;
        filename: string;
        unavailable: boolean;
      }>`
        select i.proof_id,p.id,p.filename,(p.hidden or p.archived or p.status<>'ready') as unavailable
        from catalog_proof_items i join catalog_photos p on p.id=i.photo_id
        where i.proof_id in (select jsonb_array_elements_text(${ids}::jsonb)) order by p.display_order,p.created_at,p.id`;
      return rows.map((p) => {
        const photos = items
          .filter((i) => i.proof_id === p.id)
          .map((i) => ({
            id: i.id,
            filename: i.filename,
            unavailable: i.unavailable,
            thumbSrc: `/api/catalog?op=media&id=${i.id}&kind=thumb&owner=1`,
          }));
        return {
          id: p.id,
          galleryId: p.gallery_id,
          galleryTitle: p.gallery_title,
          note: p.note,
          revision: p.revision,
          reviewedRevision: p.reviewed_revision,
          updatedAt: new Date(p.updated_at).toISOString(),
          photoIds: photos.map((i) => i.id),
          unavailableCount: photos.filter((i) => i.unavailable).length,
          photos,
        };
      });
    },
    async reviewProof(raw: { id: string; revision: number }, owner: string) {
      const data = z
        .object({ id: z.string().uuid(), revision: z.number().int().positive() })
        .strict()
        .parse(raw);
      const changed = await sql`with changed as (
        update catalog_proofs set reviewed_revision=${data.revision} where id=${data.id} and revision=${data.revision} returning id
      ), logged as (
        insert into catalog_audit(id,actor_id,action,target_id)
        select ${crypto.randomUUID()},${owner},'proof.reviewed',id from changed returning id
      ) select changed.id from changed cross join logged`;
      if (!changed.length)
        throw new CatalogError("Selection changed. Reload before marking reviewed.", 409);
      return { ok: true };
    },
  };
}
