-- Persistence only. Provider multipart creation, upload and abort remain adapter concerns.
create table if not exists catalog_multipart_uploads (
  id text primary key,
  idempotency_key text not null unique,
  owner_id text not null,
  gallery_id text not null references catalog_galleries(id),
  filename text not null check (length(filename) between 1 and 255),
  mime text not null check (mime in ('image/jpeg','image/png')),
  total_bytes integer not null check (total_bytes between 1 and 1048576000),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  request_signature text not null check (request_signature ~ '^[a-f0-9]{64}$'),
  part_size integer not null check (part_size between 5242880 and 104857600),
  part_count integer not null check (part_count between 1 and 200),
  object_key text,
  provider_upload_id text,
  status text not null default 'creating'
    check (status in ('creating','open','committing','committed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check ((provider_upload_id is null) = (object_key is null)),
  check (status <> 'creating' or provider_upload_id is null),
  check (status not in ('open','committing','committed') or provider_upload_id is not null),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);

create table if not exists catalog_multipart_parts (
  upload_id text not null references catalog_multipart_uploads(id) on delete cascade,
  part_number integer not null check (part_number between 1 and 200),
  bytes integer not null check (bytes > 0),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  provider_etag text not null check (length(provider_etag) between 1 and 512),
  created_at timestamptz not null default now(),
  primary key (upload_id,part_number)
);

create index if not exists catalog_multipart_owner_resume
  on catalog_multipart_uploads(owner_id,updated_at desc,id);
create index if not exists catalog_multipart_expiry
  on catalog_multipart_uploads(expires_at,id) where status in ('creating','open','committing');

create function catalog_multipart_identity_immutable() returns trigger language plpgsql as $$
begin
  if row(new.id,new.idempotency_key,new.owner_id,new.gallery_id,new.filename,new.mime,new.total_bytes,
    new.checksum,new.request_signature,new.part_size,new.part_count,new.created_at)
    is distinct from row(old.id,old.idempotency_key,old.owner_id,old.gallery_id,old.filename,old.mime,
    old.total_bytes,old.checksum,old.request_signature,old.part_size,old.part_count,old.created_at)
    or (old.provider_upload_id is not null and row(new.provider_upload_id,new.object_key)
      is distinct from row(old.provider_upload_id,old.object_key))
    or (old.status in ('committed','cancelled') and new.status <> old.status)
  then raise exception 'Multipart upload identity and terminal states are immutable'; end if;
  return new;
end $$;
create trigger catalog_multipart_identity_immutable before update on catalog_multipart_uploads
  for each row execute function catalog_multipart_identity_immutable();
