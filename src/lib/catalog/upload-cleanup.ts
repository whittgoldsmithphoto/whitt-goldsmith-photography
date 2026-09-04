import type { Sql } from "../db.ts";
import type { CatalogMedia } from "./repository.ts";

type CleanupCandidate = {
  id: string;
  original_key: string;
  operation_token: string;
};

export async function cleanupExpiredUploads(sql: Sql, media: CatalogMedia, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid cleanup limit");
  const operationToken = crypto.randomUUID();
  // Reuse the short-lived uploading state as an exclusive cleanup fence. A
  // duplicate reservation cannot extend an uploading row, and a fresh upload
  // cannot claim it after reserved_until has elapsed.
  const candidates = await sql.query<CleanupCandidate>(
    `with candidates as (
      select id from catalog_photos
      where reserved_until <= now()
        and original_key like 'catalog/quarantine/%'
        and (status in ('reserved','failed') or
          (status='uploading' and updated_at < now()-interval '5 minutes'))
      order by reserved_until,id
      for update skip locked
      limit $1
    )
    update catalog_photos photo set
      status='uploading',operation_token=$2,error='Expired upload cleanup in progress.',updated_at=now()
    from candidates where photo.id=candidates.id
    returning photo.id,photo.original_key,photo.operation_token`,
    [limit, operationToken],
  );
  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      await media.deleteOriginal(candidate.original_key);
      const removed = await sql.query<{ id: string }>(
        `with removed as (
          delete from catalog_photos
          where id=$1 and operation_token=$2 and reserved_until <= now()
            and original_key like 'catalog/quarantine/%'
            and status in ('reserved','failed','uploading')
          returning id,owner_id
        )
        insert into catalog_audit(id,actor_id,action,target_id)
        select $3,owner_id,'upload.expired',id from removed
        returning target_id as id`,
        [candidate.id, candidate.operation_token, crypto.randomUUID()],
      );
      if (removed.length) deleted++;
      else
        await sql.query(
          `update catalog_photos set operation_token=null where id=$1 and operation_token=$2`,
          [candidate.id, candidate.operation_token],
        );
    } catch {
      failed++;
      await sql.query(
        `update catalog_photos set status='failed',operation_token=null,
          error='Expired upload cleanup will retry.',updated_at=now()
          where id=$1 and operation_token=$2`,
        [candidate.id, candidate.operation_token],
      );
    }
  }
  return { claimed: candidates.length, deleted, failed };
}
