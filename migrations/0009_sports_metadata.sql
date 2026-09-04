create table if not exists sports_photo_metadata (
  photo_id text primary key references catalog_photos(id),
  team text not null default '',
  sport text not null default '',
  opponent text not null default '',
  event_date date,
  venue text not null default '',
  jersey_number text not null default '',
  subject text not null default '',
  notes text not null default '',
  approved boolean not null default false,
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector('simple', team || ' ' || sport || ' ' || opponent || ' ' || venue || ' ' || jersey_number || ' ' || subject)
  ) stored
);
create index if not exists sports_search_idx on sports_photo_metadata using gin(search_document) where approved;
create table if not exists sports_metadata_history (
  photo_id text not null references catalog_photos(id),
  revision integer not null,
  snapshot jsonb not null,
  actor_id text not null,
  created_at timestamptz not null default now(),
  primary key(photo_id, revision)
);
