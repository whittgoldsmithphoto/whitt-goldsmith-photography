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
  stage:
    | "pending"
    | "uploaded"
    | "validating"
    | "metadata"
    | "derivatives"
    | "ready"
    | "failed"
    | "cancelled";
  progressPercent: number;
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
  stage: MediaJob["stage"];
  progress_percent: number;
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
    stage: row.stage,
    progressPercent: row.progress_percent,
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
      status=case when catalog_media_jobs.status in ('failed','cancelled') then 'queued' else catalog_media_jobs.status end,
      attempts=case when catalog_media_jobs.status in ('failed','cancelled') then 0 else catalog_media_jobs.attempts end,
      available_at=case when catalog_media_jobs.status in ('failed','cancelled') then now() else catalog_media_jobs.available_at end,
      error_code=case when catalog_media_jobs.status in ('failed','cancelled') then null else catalog_media_jobs.error_code end,
      error_message=case when catalog_media_jobs.status in ('failed','cancelled') then null else catalog_media_jobs.error_message end,
      completed_at=case when catalog_media_jobs.status in ('failed','cancelled') then null else catalog_media_jobs.completed_at end,
      stage=case when catalog_media_jobs.status in ('failed','cancelled') then 'uploaded' else catalog_media_jobs.stage end,
      progress_percent=case when catalog_media_jobs.status in ('failed','cancelled') then 0 else catalog_media_jobs.progress_percent end
    returning *`;
  return view(rows[0]);
}

export async function loadMediaJob(sql: Sql, id: string) {
  const rows = await sql<MediaJobRow>`select * from catalog_media_jobs where id=${id}`;
  return rows[0] ? view(rows[0]) : null;
}

type ProcessingStage = "validating" | "metadata" | "derivatives";

export async function advanceMediaJobStage(
  sql: Sql,
  id: string,
  leaseToken: string,
  stage: ProcessingStage,
  progressPercent: number,
) {
  if (!Number.isInteger(progressPercent) || progressPercent < 1 || progressPercent > 99)
    throw new Error("Invalid media job progress");
  const rows = await sql.query<{ id: string }>(
    `update catalog_media_jobs set stage=$3,progress_percent=$4,updated_at=now()
      where id=$1 and status='processing' and lease_token=$2 and progress_percent < $4
        and (case stage when 'validating' then 1 when 'metadata' then 2 when 'derivatives' then 3 else 0 end)
          <= (case $3 when 'validating' then 1 when 'metadata' then 2 when 'derivatives' then 3 else -1 end)
      returning id`,
    [id, leaseToken, stage, progressPercent],
  );
  return rows.length === 1;
}

export async function heartbeatMediaJob(
  sql: Sql,
  id: string,
  leaseToken: string,
  leaseSeconds: number,
) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600)
    throw new Error("Invalid lease duration");
  const rows = await sql.query<{ id: string }>(
    `update catalog_media_jobs set
      leased_until=now()+($3::text || ' seconds')::interval,updated_at=now()
      where id=$1 and status='processing' and lease_token=$2 and leased_until > now()
      returning id`,
    [id, leaseToken, leaseSeconds],
  );
  return rows.length === 1;
}

export async function cancelMediaJobForPhoto(sql: Sql, photoId: string, ownerId: string) {
  const rows = await sql.query<{ id: string }>(
    `with cancelled as (
      update catalog_media_jobs set
        status='cancelled',lease_token=null,worker_id=null,leased_until=null,
        stage='cancelled',
        error_code='cancelled_by_owner',error_message='Processing cancelled by owner.',updated_at=now()
      where photo_id=$1 and owner_id=$2 and status in ('queued','retry','processing')
      returning photo_id
    )
    update catalog_photos set
      status='needs_review',operation_token=null,error='Processing cancelled. Resume when ready.',updated_at=now()
    where id=$1 and owner_id=$2 and exists(select 1 from cancelled where photo_id=catalog_photos.id)
    returning id`,
    [photoId, ownerId],
  );
  return rows.length === 1;
}

export async function listDispatchableMediaJobs(sql: Sql, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid dispatch limit");
  // A process killed on its final attempt cannot run failMediaJob. Reconcile
  // expired leases in a bounded statement so the owner can explicitly retry.
  // Do not reset attempts automatically or touch originals/photo visibility.
  await sql.query(
    `update catalog_media_jobs set status='failed',stage='failed',lease_token=null,
      leased_until=null,error_code='lease_exhausted',
      error_message='Processing stopped after its final attempt. Owner retry required.',updated_at=now()
      where id in (select id from catalog_media_jobs
        where status='processing' and leased_until<=now() and attempts>=max_attempts
        order by leased_until,id limit $1 for update skip locked)`,
    [limit],
  );
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
      status='processing',stage='validating',progress_percent=10,attempts=j.attempts+1,lease_token=$1,worker_id=$2,
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
      status='processing',stage='validating',progress_percent=10,attempts=attempts+1,lease_token=$2,worker_id=$3,
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
    stage='ready',progress_percent=100,
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
      stage='failed',
      available_at=now()+($3::text || ' seconds')::interval,
      lease_token=null,worker_id=null,leased_until=null,
      error_code=$4,error_message=$5,updated_at=now()
    where id=$1 and status='processing' and lease_token=$2
    returning id`,
    [id, leaseToken, retryDelaySeconds, errorCode.slice(0, 100), errorMessage.slice(0, 500)],
  );
  return rows.length === 1;
}
