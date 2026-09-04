-- Durable media-processing ledger. External work happens outside database
-- transactions; short leases make crashed workers safe to reclaim.
create table if not exists catalog_media_jobs (
  id text primary key,
  photo_id text not null references catalog_photos(id) on delete cascade,
  owner_id text not null,
  kind text not null default 'derivatives' check (kind in ('derivatives')),
  transformation_version integer not null check (transformation_version > 0),
  status text not null default 'queued'
    check (status in ('queued','processing','retry','completed','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_token text,
  worker_id text,
  leased_until timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (photo_id, kind, transformation_version),
  check ((status = 'processing') = (lease_token is not null and leased_until is not null))
);

create index if not exists catalog_media_jobs_photo_idx
  on catalog_media_jobs(photo_id, created_at desc);
create index if not exists catalog_media_jobs_owner_idx
  on catalog_media_jobs(owner_id, created_at desc);
create index if not exists catalog_media_jobs_runnable_idx
  on catalog_media_jobs(available_at, created_at, id)
  where status in ('queued','retry');
create index if not exists catalog_media_jobs_stale_lease_idx
  on catalog_media_jobs(leased_until, id)
  where status = 'processing';
