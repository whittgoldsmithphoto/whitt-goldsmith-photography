-- Durable idempotency ledger for reservation requests. These sessions do not
-- claim multipart support; they make ambiguous reservation responses replayable.
create table if not exists catalog_upload_sessions (
  idempotency_key text primary key,
  photo_id text not null references catalog_photos(id) on delete cascade,
  owner_id text not null,
  request_signature text not null check (request_signature ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);

create index if not exists catalog_upload_sessions_expiry_idx
  on catalog_upload_sessions(expires_at);
create index if not exists catalog_upload_sessions_owner_idx
  on catalog_upload_sessions(owner_id, created_at desc);
