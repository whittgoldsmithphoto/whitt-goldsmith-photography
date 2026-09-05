-- Private dynamic views only. Rules never publish galleries or copy originals.
create table catalog_smart_collections (
  id text primary key,
  owner_id text not null,
  title text not null check(length(title) between 1 and 120),
  rules jsonb not null check(jsonb_typeof(rules)='object'),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_smart_collections_owner on catalog_smart_collections(owner_id,id);
