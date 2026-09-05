-- Owner-only annotations; deliberately separate from public photo captions.
create table catalog_library_metadata (
  photo_id text primary key references catalog_photos(id),
  keywords text[] not null default '{}',
  rating integer not null default 0 check (rating between 0 and 5),
  label text not null default '' check (label in ('','select','review','reject')),
  private_notes text not null default '' check (length(private_notes)<=4000),
  revision integer not null default 1 check (revision>0),
  updated_at timestamptz not null default now(),
  check (cardinality(keywords)<=100)
);
create index catalog_metadata_keywords on catalog_library_metadata using gin(keywords);
create index catalog_metadata_rating on catalog_library_metadata(rating,photo_id);
create index catalog_metadata_label on catalog_library_metadata(label,photo_id);

create function catalog_bulk_metadata(targets jsonb, patch jsonb, actor text)
returns integer language plpgsql as $$
declare item jsonb; current_revision integer; changed integer:=0;
begin
  if actor is null or length(actor)=0 or jsonb_typeof(targets)<>'array'
    or jsonb_array_length(targets) not between 1 and 100 then raise exception 'Invalid metadata batch'; end if;
  if (select count(*) from jsonb_array_elements(targets)) <>
    (select count(distinct value->>'id') from jsonb_array_elements(targets)) then raise exception 'Duplicate metadata targets'; end if;
  -- Consistent parent-row locking protects first inserts as well as updates.
  perform p.id from catalog_photos p join jsonb_array_elements(targets) t on p.id=t->>'id'
    order by p.id for update of p;
  for item in select value from jsonb_array_elements(targets) order by value->>'id' loop
    if not exists(select 1 from catalog_photos where id=item->>'id') then raise exception 'Photo unavailable'; end if;
    select coalesce((select revision from catalog_library_metadata where photo_id=item->>'id'),0) into current_revision;
    if current_revision<>(item->>'revision')::integer then raise exception 'Metadata changed; refresh before saving'; end if;
    insert into catalog_library_metadata(photo_id) values(item->>'id') on conflict do nothing;
    update catalog_library_metadata m set
      keywords=array(select distinct word from unnest(m.keywords ||
        array(select jsonb_array_elements_text(coalesce(patch->'addKeywords','[]'::jsonb)))) word
        where not word=any(array(select jsonb_array_elements_text(coalesce(patch->'removeKeywords','[]'::jsonb)))) order by word),
      rating=coalesce((patch->>'rating')::integer,m.rating),
      label=coalesce(patch->>'label',m.label),
      private_notes=coalesce(patch->>'privateNotes',m.private_notes),
      revision=current_revision+1,updated_at=now()
      where m.photo_id=item->>'id';
    changed:=changed+1;
  end loop;
  insert into catalog_audit(id,actor_id,action,target_id)
    values(gen_random_uuid()::text,actor,'metadata.bulk',changed::text);
  return changed;
end $$;
