-- Versioned rendition manifest. A photo is published only after all seven
-- required records exist for the active transformation version.
create table if not exists catalog_media_variants (
  photo_id text not null references catalog_photos(id) on delete cascade,
  name text not null check (name in (
    'placeholder','thumbnail','thumbnail-2x','small','small-2x','display','original'
  )),
  transformation_version integer not null check (transformation_version > 0),
  object_key text not null,
  mime text not null,
  bytes integer not null check (bytes > 0),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (photo_id, name, transformation_version)
);

create unique index if not exists catalog_media_variants_object_idx
  on catalog_media_variants(object_key, name, transformation_version);
create index if not exists catalog_media_variants_photo_idx
  on catalog_media_variants(photo_id, transformation_version);
