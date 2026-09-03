create table if not exists catalog_folders (
  id text primary key,
  parent_id text references catalog_folders(id),
  title text not null,
  created_at timestamptz not null default now()
);
create table if not exists catalog_galleries (
  id text primary key,
  folder_id text references catalog_folders(id),
  title text not null,
  description text not null default '',
  category text not null default 'Sports and events',
  visibility text not null default 'private' check (visibility in ('private','public','unlisted')),
  published boolean not null default false,
  password_hash text,
  access_version integer not null default 1,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists catalog_photos (
  id text primary key,
  gallery_id text not null references catalog_galleries(id),
  owner_id text not null,
  filename text not null,
  mime text not null,
  bytes integer not null check (bytes > 0 and bytes <= 20971520),
  checksum text not null,
  original_key text not null unique,
  status text not null default 'reserved' check (status in ('reserved','uploading','uploaded','processing','ready','failed','needs_review')),
  error text,
  operation_token text,
  width integer,
  height integer,
  reserved_until timestamptz not null default now() + interval '1 hour',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (gallery_id, checksum)
);
create table if not exists catalog_derivatives (
  photo_id text not null references catalog_photos(id),
  kind text not null check (kind in ('preview','thumb')),
  object_key text not null unique,
  bytes integer not null check (bytes > 0),
  checksum text not null,
  primary key (photo_id, kind)
);
create table if not exists catalog_access_grants (
  token_hash text primary key,
  gallery_id text not null references catalog_galleries(id),
  access_version integer not null,
  expires_at timestamptz not null
);
create table if not exists catalog_access_attempts (
  gallery_id text not null references catalog_galleries(id),
  window_start timestamptz not null,
  attempts integer not null default 1,
  primary key (gallery_id, window_start)
);
create table if not exists catalog_audit (
  id text primary key,
  actor_id text,
  action text not null,
  target_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists catalog_public_idx on catalog_galleries(visibility, published);
create index if not exists catalog_photo_gallery_idx on catalog_photos(gallery_id, status);
create index if not exists catalog_grant_expiry_idx on catalog_access_grants(expires_at);
