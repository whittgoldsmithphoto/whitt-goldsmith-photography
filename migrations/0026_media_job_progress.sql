alter table catalog_media_jobs
  add column if not exists stage text not null default 'uploaded'
    check (stage in ('pending','uploaded','validating','metadata','derivatives','ready','failed','cancelled')),
  add column if not exists progress_percent integer not null default 0
    check (progress_percent between 0 and 100);

create index if not exists catalog_media_jobs_stage_idx
  on catalog_media_jobs(stage, updated_at desc);
