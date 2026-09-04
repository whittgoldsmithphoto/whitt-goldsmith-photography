-- Atomic final authorization immediately before delivering already-verified bytes.
-- This does not enable the feature; the sandbox HTTP gate remains off by default.
CREATE FUNCTION commerce_reserve_customer_download(customer text, hash text, authorized_revision integer,
  expected_key text, expected_checksum text, expected_bytes integer, access_grant_hash text, expected_gallery_id text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE e commerce_entitlements; o commerce_orders; p catalog_photos; g catalog_galleries;
BEGIN
  SELECT * INTO e FROM commerce_entitlements WHERE customer_id=customer AND token_hash=hash;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Match refund's order-first locking; never serve after a completed refund.
  SELECT * INTO o FROM commerce_orders WHERE id=e.order_id FOR UPDATE;
  IF NOT FOUND OR o.status<>'paid' OR o.customer_id IS DISTINCT FROM customer THEN RETURN false; END IF;
  SELECT * INTO p FROM catalog_photos WHERE id=e.photo_id FOR SHARE;
  IF NOT FOUND OR p.gallery_id IS DISTINCT FROM expected_gallery_id OR p.status<>'ready' OR p.hidden OR p.archived OR p.original_key IS DISTINCT FROM expected_key OR
    p.checksum IS DISTINCT FROM expected_checksum OR p.bytes IS DISTINCT FROM expected_bytes THEN RETURN false; END IF;
  SELECT * INTO g FROM catalog_galleries WHERE id=p.gallery_id FOR SHARE;
  IF NOT FOUND OR NOT g.published OR g.visibility='private' OR g.download_policy<>'purchased_only' OR
    g.revision IS DISTINCT FROM authorized_revision THEN RETURN false; END IF;
  IF g.password_hash IS NOT NULL THEN
    PERFORM token_hash FROM catalog_access_grants WHERE token_hash=access_grant_hash AND gallery_id=g.id
      AND access_version=g.access_version AND expires_at>now() FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  UPDATE commerce_entitlements SET downloads=downloads+1
    WHERE id=e.id AND customer_id=customer AND token_hash=hash AND revoked_at IS NULL AND expires_at>now() AND downloads<max_downloads;
  RETURN FOUND;
END $$;
