CREATE TABLE catalog_proofs (
  id text PRIMARY KEY,
  gallery_id text NOT NULL REFERENCES catalog_galleries(id),
  customer_id text NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  reviewed_revision integer NOT NULL DEFAULT 0 CHECK (reviewed_revision >= 0 AND reviewed_revision <= revision),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gallery_id, customer_id)
);
CREATE INDEX catalog_proofs_customer ON catalog_proofs(customer_id);
CREATE INDEX catalog_proofs_updated ON catalog_proofs(updated_at DESC, id);
CREATE TABLE catalog_proof_items (
  proof_id text NOT NULL REFERENCES catalog_proofs(id) ON DELETE CASCADE,
  photo_id text NOT NULL REFERENCES catalog_photos(id),
  PRIMARY KEY (proof_id, photo_id)
);
CREATE INDEX catalog_proof_items_photo ON catalog_proof_items(photo_id);
