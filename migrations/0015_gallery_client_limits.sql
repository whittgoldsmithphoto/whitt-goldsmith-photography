CREATE TABLE catalog_client_attempts (
  gallery_id text NOT NULL REFERENCES catalog_galleries(id),
  client_bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  blocked_until timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(gallery_id,client_bucket)
);
