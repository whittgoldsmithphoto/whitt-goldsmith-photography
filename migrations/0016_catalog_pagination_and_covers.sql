-- Additive only: original IDs, media objects and entitlements remain unchanged.
alter table catalog_galleries add column if not exists cover_photo_id text references catalog_photos(id);
alter table catalog_galleries add column if not exists published_at timestamptz;
-- Do not invent historical publication dates for existing galleries.
create or replace function catalog_record_publication() returns trigger language plpgsql as $$
begin
  if NEW.published and (TG_OP = 'INSERT' or not OLD.published) then NEW.published_at := now(); end if;
  return NEW;
end $$;
drop trigger if exists catalog_publication_timestamp on catalog_galleries;
create trigger catalog_publication_timestamp before insert or update on catalog_galleries for each row execute function catalog_record_publication();
create index if not exists catalog_gallery_title_page on catalog_galleries(title,id);
create index if not exists catalog_public_title_page on catalog_galleries(title,id) where published and visibility='public' and password_hash is null;
create index if not exists catalog_photo_order_page on catalog_photos(gallery_id,display_order,id) where status='ready';
create index if not exists catalog_folder_parent_page on catalog_folders(parent_id,title,id);
