-- Commerce is a separate, closed server domain until provider acceptance passes.
-- Integer cents only; SQL functions keep transitions atomic even with Hyperdrive's
-- one-connection-per-query adapter. These are INVOKER functions, never elevated.
CREATE TABLE commerce_price_lists (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  is_default boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX commerce_one_default_list ON commerce_price_lists(is_default) WHERE is_default;
CREATE TABLE commerce_products (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('digital_photo','print')),
  active boolean NOT NULL DEFAULT false,
  license text NOT NULL CHECK (length(license) BETWEEN 1 AND 4000),
  width_inches numeric(6,2), height_inches numeric(6,2),
  minimum_dpi integer NOT NULL DEFAULT 150 CHECK (minimum_dpi BETWEEN 72 AND 600),
  CHECK (kind <> 'print' OR (width_inches > 0 AND height_inches > 0))
);
CREATE TABLE commerce_prices (
  price_list_id text NOT NULL REFERENCES commerce_price_lists(id),
  product_id text NOT NULL REFERENCES commerce_products(id),
  unit_cents integer NOT NULL CHECK (unit_cents BETWEEN 1 AND 10000000),
  PRIMARY KEY (price_list_id, product_id)
);
CREATE TABLE commerce_gallery_prices (
  gallery_id text PRIMARY KEY REFERENCES catalog_galleries(id),
  price_list_id text NOT NULL REFERENCES commerce_price_lists(id)
);
CREATE INDEX commerce_price_product ON commerce_prices(product_id);
CREATE INDEX commerce_gallery_price_list ON commerce_gallery_prices(price_list_id);
CREATE TABLE commerce_coupons (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{3,40}$'),
  percent_off integer NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  max_uses integer NOT NULL CHECK (max_uses > 0),
  consumed integer NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  minimum_cents integer NOT NULL DEFAULT 0 CHECK (minimum_cents >= 0),
  gallery_id text REFERENCES catalog_galleries(id),
  expires_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE commerce_quotes (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  gallery_id text NOT NULL REFERENCES catalog_galleries(id),
  access_version integer NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents > 0),
  discount_cents integer NOT NULL CHECK (discount_cents >= 0),
  shipping_cents integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  currency text NOT NULL CHECK (currency = 'usd'),
  coupon_code text REFERENCES commerce_coupons(code),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','ordered','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents - discount_cents + shipping_cents + tax_cents),
  CHECK (discount_cents <= subtotal_cents)
);
CREATE INDEX commerce_quote_customer ON commerce_quotes(customer_id, created_at DESC);
CREATE INDEX commerce_quote_gallery ON commerce_quotes(gallery_id);
CREATE INDEX commerce_quote_coupon ON commerce_quotes(coupon_code);
CREATE INDEX commerce_coupon_gallery ON commerce_coupons(gallery_id);
CREATE INDEX commerce_coupon_reservations ON commerce_quotes(coupon_code, expires_at) WHERE status = 'open';
CREATE TABLE commerce_orders (
  id text PRIMARY KEY,
  quote_id text NOT NULL UNIQUE REFERENCES commerce_quotes(id),
  customer_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  provider_session_id text UNIQUE,
  provider_payment_id text UNIQUE,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_order_customer ON commerce_orders(customer_id, created_at DESC);
CREATE TABLE commerce_payment_events (
  provider_event_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(id),
  kind text NOT NULL CHECK (kind IN ('paid','failed','refunded')),
  payment_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commerce_entitlements (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(id),
  photo_id text NOT NULL REFERENCES catalog_photos(id),
  customer_id text NOT NULL,
  token_hash text UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  downloads integer NOT NULL DEFAULT 0 CHECK (downloads >= 0),
  max_downloads integer NOT NULL DEFAULT 10 CHECK (max_downloads > 0),
  UNIQUE (order_id, photo_id)
);
CREATE INDEX commerce_event_order ON commerce_payment_events(order_id);
CREATE INDEX commerce_entitlement_photo ON commerce_entitlements(photo_id);
CREATE INDEX commerce_entitlement_order ON commerce_entitlements(order_id);
CREATE INDEX commerce_entitlement_customer ON commerce_entitlements(customer_id);

CREATE FUNCTION commerce_create_quote(qid text, customer text, gallery text, selections jsonb, coupon text, authorized_revision integer)
RETURNS commerce_quotes LANGUAGE plpgsql AS $$
DECLARE
  g catalog_galleries; c commerce_coupons; result commerce_quotes;
  item jsonb; snapshots jsonb := '[]'; product commerce_products;
  photo catalog_photos; amount integer; qty integer; subtotal bigint := 0;
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
    -- Prints require shipping/tax/crop/provider validation, intentionally closed.
    IF product.kind <> 'digital_photo' OR qty <> 1 THEN RAISE EXCEPTION 'Product not enabled for checkout'; END IF;
    SELECT * INTO photo FROM catalog_photos WHERE id = item->>'photoId' AND gallery_id = gallery
      AND status = 'ready' AND NOT hidden AND NOT archived FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Photo unavailable'; END IF;
    SELECT unit_cents INTO amount FROM commerce_prices WHERE price_list_id = list_id AND product_id = product.id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product price unavailable'; END IF;
    subtotal := subtotal + amount * qty;
    IF subtotal > 100000000 THEN RAISE EXCEPTION 'Quote exceeds maximum'; END IF;
    snapshots := snapshots || jsonb_build_array(jsonb_build_object('productId',product.id,'photoId',photo.id,
      'name',product.name,'kind',product.kind,'license',product.license,'filename',photo.filename,
      'quantity',qty,'unitCents',amount,'lineCents',amount * qty));
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

CREATE FUNCTION commerce_reserve_download(customer text, hash text)
RETURNS TABLE(original_key text, filename text, mime text) LANGUAGE plpgsql AS $$
DECLARE entitlement commerce_entitlements; order_status text;
BEGIN
  SELECT * INTO entitlement FROM commerce_entitlements WHERE token_hash=hash AND customer_id=customer;
  IF NOT FOUND THEN RETURN; END IF;
  -- Same order-first lock order as refunds; a completed refund cannot race a grant.
  SELECT status INTO order_status FROM commerce_orders WHERE id=entitlement.order_id FOR UPDATE;
  IF order_status <> 'paid' THEN RETURN; END IF;
  UPDATE commerce_entitlements e SET downloads=downloads+1 WHERE e.id=entitlement.id AND e.token_hash=hash
    AND e.revoked_at IS NULL AND e.expires_at>now() AND e.downloads<e.max_downloads
    RETURNING * INTO entitlement;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT p.original_key,p.filename,p.mime FROM catalog_photos p
    WHERE p.id=entitlement.photo_id AND p.status='ready' AND NOT p.archived;
END $$;

CREATE FUNCTION commerce_create_order(oid text, qid text, customer text)
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
  ) THEN RAISE EXCEPTION 'Gallery or photo no longer available'; END IF;
  INSERT INTO commerce_orders(id,quote_id,customer_id) VALUES(oid,qid,customer) RETURNING * INTO result;
  UPDATE commerce_quotes SET status = 'ordered' WHERE id = qid;
  RETURN result;
END $$;

-- Only call after the provider adapter has verified the signature, account,
-- environment, session ID, payment status, amount and currency. No public route.
CREATE FUNCTION commerce_apply_payment(event_id text, oid text, event_kind text, session_id text, payment_id text,
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
  -- Never revive an expired/failed or refunded order on a delayed success event.
  IF (event_kind = 'paid' AND o.status NOT IN ('pending','paid')) OR
     (event_kind = 'refunded' AND o.status NOT IN ('paid','refunded')) THEN RAISE EXCEPTION 'Invalid payment transition'; END IF;
  INSERT INTO commerce_payment_events(provider_event_id,order_id,kind,payment_id,amount_cents,currency)
    VALUES(event_id,oid,event_kind,payment_id,amount,event_currency);
  IF event_kind = 'paid' AND o.status = 'pending' THEN
    UPDATE commerce_orders SET status = 'paid', provider_payment_id = payment_id, paid_at = now(), updated_at = now()
      WHERE id = oid RETURNING * INTO o;
    IF q.coupon_code IS NOT NULL THEN UPDATE commerce_coupons SET consumed = consumed + 1 WHERE code = q.coupon_code; END IF;
    INSERT INTO commerce_entitlements(id,order_id,photo_id,customer_id,expires_at)
      SELECT oid || ':' || (i->>'photoId'),oid,i->>'photoId',o.customer_id,now() + interval '30 days'
      FROM jsonb_array_elements(q.items) i WHERE i->>'kind' = 'digital_photo'
      ON CONFLICT (order_id,photo_id) DO NOTHING;
  ELSIF event_kind = 'refunded' THEN
    UPDATE commerce_orders SET status = 'refunded', updated_at = now() WHERE id = oid RETURNING * INTO o;
    UPDATE commerce_entitlements SET revoked_at = COALESCE(revoked_at,now()), token_hash = NULL WHERE order_id = oid;
  ELSIF event_kind = 'failed' AND o.status = 'pending' THEN
    UPDATE commerce_orders SET status = 'failed', updated_at = now() WHERE id = oid RETURNING * INTO o;
  END IF;
  RETURN o;
END $$;
