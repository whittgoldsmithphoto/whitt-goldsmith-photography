ALTER TABLE catalog_photos
  ADD COLUMN caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 2000),
  ADD COLUMN hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN archived boolean NOT NULL DEFAULT false,
  ADD COLUMN display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE INDEX catalog_photos_visible_order ON catalog_photos(gallery_id, display_order, created_at, id)
  WHERE status = 'ready' AND hidden = false AND archived = false;
