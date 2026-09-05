-- Counts one attempt for every photo in a verified, completed paid album ZIP.
-- Locks the order first, matching individual delivery/refund serialization.
-- Caller must have opened the exact private object before reserving delivery.
CREATE FUNCTION commerce_reserve_archive_download(customer text, job_id text,
  expected_key text, expected_checksum text, expected_bytes bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  j commerce_archive_jobs; o commerce_orders; q commerce_quotes;
  p catalog_photos; g catalog_galleries;
  ids text[]; entry jsonb; eligible_count integer;
BEGIN
  SELECT * INTO j FROM commerce_archive_jobs WHERE id=job_id AND customer_id=customer
    AND status='completed' AND output_key=expected_key
    AND output_checksum=expected_checksum AND output_bytes=expected_bytes FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO o FROM commerce_orders WHERE id=j.order_id AND customer_id=customer FOR UPDATE;
  IF NOT FOUND OR o.status<>'paid' THEN RETURN false; END IF;
  SELECT * INTO q FROM commerce_quotes WHERE id=o.quote_id AND customer_id=customer;
  IF NOT FOUND OR jsonb_array_length(q.items)<>1 OR q.items->0->>'kind'<>'gallery_download'
    OR q.items->0->>'quantity'<>'1' OR jsonb_typeof(q.items->0->'photoIds') IS DISTINCT FROM 'array'
    THEN RETURN false; END IF;
  SELECT array_agg(value ORDER BY value) INTO ids FROM jsonb_array_elements_text(q.items->0->'photoIds');
  IF cardinality(ids) NOT BETWEEN 1 AND 500
    OR cardinality(ids)<>(SELECT count(DISTINCT value) FROM unnest(ids) value)
    OR ids IS DISTINCT FROM ARRAY(SELECT value->>'photoId' FROM jsonb_array_elements(j.manifest) ORDER BY value->>'photoId')
    THEN RETURN false; END IF;
  -- Consistent photo lock order prevents mixed individual/ZIP deliveries from
  -- observing replacements, hidden originals or different galleries midway.
  FOR p IN SELECT * FROM catalog_photos WHERE id=ANY(ids) ORDER BY id FOR SHARE LOOP
    SELECT value INTO entry FROM jsonb_array_elements(j.manifest) WHERE value->>'photoId'=p.id;
    IF p.gallery_id<>q.gallery_id OR p.status<>'ready' OR p.hidden OR p.archived
      OR p.original_key IS DISTINCT FROM entry->>'objectKey'
      OR p.checksum IS DISTINCT FROM entry->>'checksum'
      OR p.bytes::text IS DISTINCT FROM entry->>'bytes'
      OR p.filename IS DISTINCT FROM entry->>'filename' THEN RETURN false; END IF;
  END LOOP;
  SELECT * INTO g FROM catalog_galleries WHERE id=q.gallery_id FOR SHARE;
  IF NOT FOUND OR NOT g.published OR g.visibility<>'public' OR g.download_policy<>'purchased_only'
    THEN RETURN false; END IF;
  PERFORM id FROM commerce_entitlements WHERE order_id=o.id AND customer_id=customer
    AND photo_id=ANY(ids) ORDER BY photo_id FOR UPDATE;
  SELECT count(*) INTO eligible_count FROM commerce_entitlements e JOIN catalog_photos stored_photo ON stored_photo.id=e.photo_id
    WHERE e.order_id=o.id AND e.customer_id=customer AND e.photo_id=ANY(ids)
      AND e.revoked_at IS NULL AND e.expires_at>now() AND e.downloads<e.max_downloads;
  IF eligible_count<>cardinality(ids) THEN RETURN false; END IF;
  UPDATE commerce_entitlements SET downloads=downloads+1
    WHERE order_id=o.id AND customer_id=customer AND photo_id=ANY(ids);
  RETURN true;
END;
$$;
