-- Provider-confirmed adverse outcomes: immutable audit, conservative delivery hold.
ALTER TABLE commerce_orders DROP CONSTRAINT commerce_orders_status_check;
ALTER TABLE commerce_orders ADD CONSTRAINT commerce_orders_status_check
  CHECK(status IN ('pending','paid','failed','refunded','review'));
CREATE TABLE commerce_payment_reviews (
  provider_event_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(id),
  session_id text NOT NULL,
  payment_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('partial_refund','full_refund','dispute')),
  amount_cents integer NOT NULL CHECK(amount_cents >= 0),
  currency text NOT NULL CHECK(currency='usd'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_payment_review_order ON commerce_payment_reviews(order_id,created_at);
CREATE FUNCTION commerce_apply_payment_review(eid text, oid text, sid text, pid text,
  review_kind text, amount integer, event_currency text)
RETURNS commerce_orders LANGUAGE plpgsql AS $$
DECLARE o commerce_orders; q commerce_quotes; previous commerce_payment_reviews;
BEGIN
  IF eid IS NULL OR eid='' OR pid IS NULL OR pid='' OR review_kind IS NULL OR
    review_kind NOT IN ('partial_refund','full_refund','dispute') THEN RAISE EXCEPTION 'Invalid payment review'; END IF;
  SELECT * INTO o FROM commerce_orders WHERE id=oid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable'; END IF;
  SELECT * INTO q FROM commerce_quotes WHERE id=o.quote_id;
  IF sid IS DISTINCT FROM o.provider_session_id OR sid IS NULL OR amount IS DISTINCT FROM q.total_cents OR
    event_currency IS DISTINCT FROM q.currency OR (o.provider_payment_id IS NOT NULL AND pid IS DISTINCT FROM o.provider_payment_id)
    THEN RAISE EXCEPTION 'Payment review identity mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM commerce_payment_events WHERE provider_event_id=eid) OR
    EXISTS(SELECT 1 FROM commerce_session_events WHERE provider_event_id=eid)
    THEN RAISE EXCEPTION 'Conflicting event replay'; END IF;
  SELECT * INTO previous FROM commerce_payment_reviews WHERE provider_event_id=eid;
  IF FOUND THEN
    IF previous.order_id IS DISTINCT FROM oid OR previous.session_id IS DISTINCT FROM sid OR
      previous.payment_id IS DISTINCT FROM pid OR previous.kind IS DISTINCT FROM review_kind OR
      previous.amount_cents IS DISTINCT FROM amount OR previous.currency IS DISTINCT FROM event_currency
      THEN RAISE EXCEPTION 'Conflicting event replay'; END IF;
    RETURN o;
  END IF;
  INSERT INTO commerce_payment_reviews(provider_event_id,order_id,session_id,payment_id,kind,amount_cents,currency)
    VALUES(eid,oid,sid,pid,review_kind,amount,event_currency);
  UPDATE commerce_orders SET status=CASE WHEN status='refunded' OR review_kind='full_refund' THEN 'refunded' ELSE 'review' END,
    provider_payment_id=pid,updated_at=now() WHERE id=oid RETURNING * INTO o;
  UPDATE commerce_entitlements SET revoked_at=COALESCE(revoked_at,now()),token_hash=NULL WHERE order_id=oid;
  -- Never restore grants automatically, including a later dispute-won event.
  RETURN o;
END $$;
