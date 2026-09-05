-- A constant default preserves the existing presentation for every gallery.
ALTER TABLE catalog_galleries
  ADD COLUMN layout text NOT NULL DEFAULT 'compact'
  CHECK (layout IN ('compact', 'comfortable'));
