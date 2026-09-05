-- Gallery-download checkout. A gallery purchase snapshots every currently
-- purchasable photo ID, then grants one bounded entitlement per photo.
ALTER TABLE commerce_products DROP CONSTRAINT IF EXISTS commerce_products_kind_check;
ALTER TABLE commerce_products
  ADD CONSTRAINT commerce_products_kind_check CHECK (kind IN ('digital_photo','gallery_download','print'));

ALTER TABLE commerce_entitlements ALTER COLUMN max_downloads SET DEFAULT 3;
UPDATE commerce_entitlements SET max_downloads = LEAST(max_downloads, 3);
UPDATE commerce_entitlements
  SET expires_at = LEAST(expires_at, now() + interval '14 days');

CREATE OR REPLACE FUNCTION commerce_create_quote(qid text, customer text, gallery text, selections jsonb, coupon text, authorized_revision integer)
RETURNS commerce_quotes LANGUAGE plpgsql AS $$
DECLARE
  g catalog_galleries; c commerce_coupons; result commerce_quotes;
  item jsonb; snapshots jsonb := '[]'; product commerce_products;
  photo catalog_photos; photo_ids jsonb; amount integer; qty integer; subtotal bigint := 0;
  discount integer := 0; list_id text; reserved integer;
BEGIN
  IF customer IS NULL OR length(customer) < 1 OR jsonb_typeof(selections) <> 'array'
     OR jsonb_array_length(selections) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid quote request';
  END IF;
  SELECT * INTO g FROM catalog_galleries WHERE id = gallery FOR SHARE;
  IF NOT FOUND OR NOT g.published OR g.visibility = 'private' OR g.revision <> authorized_revision THEN RAISE EXCEPTION 'Gallery unavailable'; END IF;
  SELECT price_list_id INTO list_id FROM commerce_gallery_prices WHERE gallery_id = gallery;
  IF list_id IS NULL THEN SELECT id INTO list_id FROM commerce_price_lists WHERE is_default; END IF;
  IF list_id IS NULL THEN RAISE EXCEPTION 'Pricing unavailable'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(selections)) <>
     (SELECT count(DISTINCT (v->>'productId',v->>'photoId')) FROM jsonb_array_elements(selections) v) THEN
    RAISE EXCEPTION 'Duplicate selections';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(selections) LOOP
    IF item->>'quantity' IS NULL OR item->>'quantity' !~ '^[1-9][0-9]?$' THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    qty := (item->>'quantity')::integer;
    SELECT * INTO product FROM commerce_products WHERE id = item->>'productId' AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable'; END IF;
    SELECT unit_cents INTO amount FROM commerce_prices WHERE price_list_id = list_id AND product_id = product.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product price unavailable'; END IF;
    IF product.kind = 'digital_photo' THEN
      IF qty <> 1 THEN RAISE EXCEPTION 'Product not enabled for checkout'; END IF;
      SELECT * INTO photo FROM catalog_photos WHERE id = item->>'photoId' AND gallery_id = gallery
        AND status = 'ready' AND NOT hidden AND NOT archived FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Photo unavailable'; END IF;
      snapshots := snapshots || jsonb_build_array(jsonb_build_object('productId',product.id,'photoId',photo.id,
        'name',product.name,'kind',product.kind,'license',product.license,'filename',photo.filename,
        'quantity',qty,'unitCents',amount,'lineCents',amount * qty));
    ELSIF product.kind = 'gallery_download' THEN
      IF qty <> 1 THEN RAISE EXCEPTION 'Product not enabled for checkout'; END IF;
      SELECT * INTO photo FROM catalog_photos WHERE id = item->>'photoId' AND gallery_id = gallery
        AND status = 'ready' AND NOT hidden AND NOT archived FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Gallery has no purchasable photos'; END IF;
      SELECT jsonb_agg(p.id ORDER BY p.display_order,p.id) INTO photo_ids
        FROM catalog_photos p WHERE p.gallery_id=gallery AND p.status='ready' AND NOT p.hidden AND NOT p.archived;
      snapshots := snapshots || jsonb_build_array(jsonb_build_object('productId',product.id,'photoId',photo.id,
        'photoIds',photo_ids,'name',product.name,'kind',product.kind,'license',product.license,
        'filename',g.title || ' — full gallery','quantity',qty,'unitCents',amount,'lineCents',amount * qty));
    ELSE
      RAISE EXCEPTION 'Product not enabled for checkout';
    END IF;
    subtotal := subtotal + amount * qty;
    IF subtotal > 100000000 THEN RAISE EXCEPTION 'Quote exceeds maximum'; END IF;
  END LOOP;
  IF coupon IS NOT NULL THEN
    SELECT * INTO c FROM commerce_coupons WHERE code = coupon FOR UPDATE;
    IF NOT FOUND OR NOT c.active OR c.expires_at <= now() OR subtotal < c.minimum_cents
      OR (c.gallery_id IS NOT NULL AND c.gallery_id <> gallery) THEN RAISE EXCEPTION 'Coupon unavailable'; END IF;
    SELECT count(*) INTO reserved FROM commerce_quotes q WHERE q.coupon_code = coupon AND
      ((q.status = 'open' AND q.expires_at > now()) OR
       (q.status = 'ordered' AND EXISTS (SELECT 1 FROM commerce_orders o WHERE o.quote_id = q.id AND o.status = 'pending')));
    IF c.consumed + reserved >= c.max_uses THEN RAISE EXCEPTION 'Coupon exhausted'; END IF;
    discount := floor(subtotal * c.percent_off / 100.0)::integer;
  END IF;
  INSERT INTO commerce_quotes(id,customer_id,gallery_id,access_version,items,subtotal_cents,discount_cents,total_cents,
    currency,coupon_code,expires_at) VALUES(qid,customer,gallery,g.access_version,snapshots,subtotal,discount,subtotal-discount,
    'usd',coupon,now() + interval '15 minutes') RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION commerce_create_order(oid text, qid text, customer text)
RETURNS commerce_orders LANGUAGE plpgsql AS $$
DECLARE q commerce_quotes; result commerce_orders;
BEGIN
  SELECT * INTO q FROM commerce_quotes WHERE id = qid AND customer_id = customer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote unavailable'; END IF;
  SELECT * INTO result FROM commerce_orders WHERE quote_id = qid;
  IF FOUND THEN RETURN result; END IF;
  IF q.status <> 'open' OR q.expires_at <= now() THEN RAISE EXCEPTION 'Quote expired'; END IF;
  IF NOT EXISTS (SELECT 1 FROM catalog_galleries WHERE id = q.gallery_id AND published AND visibility <> 'private'
     AND access_version = q.access_version) OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(q.items) i LEFT JOIN catalog_photos p ON p.id = i->>'photoId'
     WHERE p.id IS NULL OR p.status <> 'ready' OR p.hidden OR p.archived OR p.gallery_id <> q.gallery_id
  ) OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(q.items) i
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(i->'photoIds','[]'::jsonb)) ids
     LEFT JOIN catalog_photos p ON p.id = ids
     WHERE i->>'kind'='gallery_download' AND
       (p.id IS NULL OR p.status <> 'ready' OR p.hidden OR p.archived OR p.gallery_id <> q.gallery_id)
  ) THEN RAISE EXCEPTION 'Gallery or photo no longer available'; END IF;
  INSERT INTO commerce_orders(id,quote_id,customer_id) VALUES(oid,qid,customer) RETURNING * INTO result;
  UPDATE commerce_quotes SET status = 'ordered' WHERE id = qid;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION commerce_apply_payment(event_id text, oid text, event_kind text, session_id text, payment_id text,
  amount integer, event_currency text) RETURNS commerce_orders LANGUAGE plpgsql AS $$
DECLARE o commerce_orders; q commerce_quotes; previous commerce_payment_events;
BEGIN
  SELECT * INTO o FROM commerce_orders WHERE id = oid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable'; END IF;
  SELECT * INTO q FROM commerce_quotes WHERE id = o.quote_id;
  IF event_kind NOT IN ('paid','failed','refunded') OR o.provider_session_id IS NULL OR o.provider_session_id <> session_id
     OR payment_id IS NULL OR length(payment_id) = 0 OR amount <> q.total_cents OR event_currency <> q.currency THEN
    RAISE EXCEPTION 'Payment does not match order';
  END IF;
  IF o.provider_payment_id IS NOT NULL AND o.provider_payment_id <> payment_id THEN RAISE EXCEPTION 'Payment identity mismatch'; END IF;
  SELECT * INTO previous FROM commerce_payment_events WHERE provider_event_id = event_id;
  IF FOUND THEN
    IF previous.order_id <> oid OR previous.kind <> event_kind OR previous.payment_id <> payment_id
       OR previous.amount_cents <> amount OR previous.currency <> event_currency THEN RAISE EXCEPTION 'Conflicting event replay'; END IF;
    RETURN o;
  END IF;
  IF (event_kind = 'paid' AND o.status NOT IN ('pending','paid')) OR
     (event_kind = 'refunded' AND o.status NOT IN ('paid','refunded')) THEN RAISE EXCEPTION 'Invalid payment transition'; END IF;
  INSERT INTO commerce_payment_events(provider_event_id,order_id,kind,payment_id,amount_cents,currency)
    VALUES(event_id,oid,event_kind,payment_id,amount,event_currency);
  IF event_kind = 'paid' AND o.status = 'pending' THEN
    UPDATE commerce_orders SET status = 'paid', provider_payment_id = payment_id, paid_at = now(), updated_at = now()
      WHERE id = oid RETURNING * INTO o;
    IF q.coupon_code IS NOT NULL THEN UPDATE commerce_coupons SET consumed = consumed + 1 WHERE code = q.coupon_code; END IF;
    INSERT INTO commerce_entitlements(id,order_id,photo_id,customer_id,expires_at,max_downloads)
      SELECT oid || ':' || (i->>'photoId'),oid,i->>'photoId',o.customer_id,now() + interval '14 days',3
      FROM jsonb_array_elements(q.items) i WHERE i->>'kind' = 'digital_photo'
      ON CONFLICT (order_id,photo_id) DO NOTHING;
    INSERT INTO commerce_entitlements(id,order_id,photo_id,customer_id,expires_at,max_downloads)
      SELECT oid || ':' || ids,oid,ids,o.customer_id,now() + interval '14 days',3
      FROM jsonb_array_elements(q.items) i
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(i->'photoIds','[]'::jsonb)) ids
      WHERE i->>'kind' = 'gallery_download'
      ON CONFLICT (order_id,photo_id) DO NOTHING;
  ELSIF event_kind = 'refunded' THEN
    UPDATE commerce_orders SET status = 'refunded', updated_at = now() WHERE id = oid RETURNING * INTO o;
    UPDATE commerce_entitlements SET revoked_at = COALESCE(revoked_at,now()), token_hash = NULL WHERE order_id = oid;
  ELSIF event_kind = 'failed' AND o.status = 'pending' THEN
    UPDATE commerce_orders SET status = 'failed', updated_at = now() WHERE id = oid RETURNING * INTO o;
  END IF;
  RETURN o;
END $$;
