import type { Sql } from "../db.ts";

export type MediaJob = {
  id: string;
  photoId: string;
  ownerId: string;
  kind: "derivatives";
  transformationVersion: number;
  status: "queued" | "processing" | "retry" | "completed" | "failed" | "cancelled";
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
};

type MediaJobRow = {
  id: string;
  photo_id: string;
  owner_id: string;
  kind: "derivatives";
  transformation_version: number;
  status: MediaJob["status"];
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
};

function view(row: MediaJobRow): MediaJob {
  return {
    id: row.id,
    photoId: row.photo_id,
    ownerId: row.owner_id,
    kind: row.kind,
    transformationVersion: row.transformation_version,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
  };
}

export async function enqueueMediaJob(
  sql: Sql,
  input: {
    photoId: string;
    ownerId: string;
    transformationVersion: number;
    maxAttempts?: number;
  },
) {
  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(input.transformationVersion) || input.transformationVersion < 1)
    throw new Error("Invalid transformation version");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20)
    throw new Error("Invalid maximum attempts");
  const rows = await sql<MediaJobRow>`insert into catalog_media_jobs(
      id,photo_id,owner_id,transformation_version,max_attempts
    ) values (
      ${crypto.randomUUID()},${input.photoId},${input.ownerId},${input.transformationVersion},${maxAttempts}
    ) on conflict(photo_id,kind,transformation_version) do update set
      owner_id=excluded.owner_id,
      status=case when catalog_media_jobs.status='failed' then 'queued' else catalog_media_jobs.status end,
      attempts=case when catalog_media_jobs.status='failed' then 0 else catalog_media_jobs.attempts end,
      available_at=case when catalog_media_jobs.status='failed' then now() else catalog_media_jobs.available_at end,
      error_code=case when catalog_media_jobs.status='failed' then null else catalog_media_jobs.error_code end,
      error_message=case when catalog_media_jobs.status='failed' then null else catalog_media_jobs.error_message end
    returning *`;
  return view(rows[0]);
}

export async function loadMediaJob(sql: Sql, id: string) {
  const rows = await sql<MediaJobRow>`select * from catalog_media_jobs where id=${id}`;
  return rows[0] ? view(rows[0]) : null;
}

export async function listDispatchableMediaJobs(sql: Sql, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid dispatch limit");
  const rows = await sql.query<MediaJobRow>(
    `select * from catalog_media_jobs
      where attempts < max_attempts and (
        (status in ('queued','retry') and available_at <= now()) or
        (status='processing' and leased_until <= now())
      )
      order by available_at,created_at,id
      limit $1`,
    [limit],
  );
  return rows.map(view);
}

export async function claimNextMediaJob(sql: Sql, workerId: string, leaseSeconds: number) {
  if (!workerId || workerId.length > 200) throw new Error("Invalid worker ID");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600)
    throw new Error("Invalid lease duration");
  const leaseToken = crypto.randomUUID();
  const rows = await sql.query<MediaJobRow>(
    `with candidate as (
      select id from catalog_media_jobs
      where attempts < max_attempts and (
        (status in ('queued','retry') and available_at <= now()) or
        (status='processing' and leased_until <= now())
      )
      order by available_at,created_at,id
      for update skip locked
      limit 1
    )
    update catalog_media_jobs j set
      status='processing',attempts=j.attempts+1,lease_token=$1,worker_id=$2,
      leased_until=now()+($3::text || ' seconds')::interval,
      error_code=null,error_message=null,updated_at=now()
    from candidate where j.id=candidate.id
    returning j.*`,
    [leaseToken, workerId, leaseSeconds],
  );
  return rows[0] ? view(rows[0]) : null;
}

export async function claimMediaJobForPhoto(
  sql: Sql,
  photoId: string,
  workerId: string,
  leaseSeconds: number,
) {
  if (!workerId || workerId.length > 200) throw new Error("Invalid worker ID");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600)
    throw new Error("Invalid lease duration");
  const leaseToken = crypto.randomUUID();
  const rows = await sql.query<MediaJobRow>(
    `update catalog_media_jobs set
      status='processing',attempts=attempts+1,lease_token=$2,worker_id=$3,
      leased_until=now()+($4::text || ' seconds')::interval,
      error_code=null,error_message=null,updated_at=now()
    where photo_id=$1 and attempts < max_attempts and (
      status in ('queued','retry') or
      (status='processing' and leased_until <= now())
    )
    returning *`,
    [photoId, leaseToken, workerId, leaseSeconds],
  );
  return rows[0] ? view(rows[0]) : null;
}

export async function completeMediaJob(sql: Sql, id: string, leaseToken: string) {
  const rows = await sql`update catalog_media_jobs set
    status='completed',lease_token=null,worker_id=null,leased_until=null,
    error_code=null,error_message=null,completed_at=now(),updated_at=now()
    where id=${id} and status='processing' and lease_token=${leaseToken}
    returning id`;
  return rows.length === 1;
}

export async function failMediaJob(
  sql: Sql,
  id: string,
  leaseToken: string,
  errorCode: string,
  errorMessage: string,
  retryDelaySeconds: number,
) {
  if (!Number.isInteger(retryDelaySeconds) || retryDelaySeconds < 0 || retryDelaySeconds > 86400)
    throw new Error("Invalid retry delay");
  const rows = await sql.query<{ id: string }>(
    `update catalog_media_jobs set
      status=case when attempts >= max_attempts then 'failed' else 'retry' end,
      available_at=now()+($3::text || ' seconds')::interval,
      lease_token=null,worker_id=null,leased_until=null,
      error_code=$4,error_message=$5,updated_at=now()
    where id=$1 and status='processing' and lease_token=$2
    returning id`,
    [id, leaseToken, retryDelaySeconds, errorCode.slice(0, 100), errorMessage.slice(0, 500)],
  );
  return rows.length === 1;
}
