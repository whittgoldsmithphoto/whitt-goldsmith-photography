-- Separate terminal Checkout Session ledger. Expiration often has no PaymentIntent:
-- do not invent a payment ID or weaken the payment-confirmation event contract.
CREATE TABLE commerce_session_events (
  provider_event_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(id),
  session_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('expired','async_failed')),
  payment_id text,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL CHECK (currency = 'usd'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_session_event_order ON commerce_session_events(order_id);

-- Only verified, provider-reread terminal session outcomes may enter here.
-- Each call is one transaction; Hyperdrive connections need not be shared.
CREATE FUNCTION commerce_apply_session_outcome(event_id text, oid text, event_kind text,
  sid text, pid text, amount integer, event_currency text)
RETURNS commerce_orders LANGUAGE plpgsql AS $$
DECLARE o commerce_orders; q commerce_quotes; previous commerce_session_events;
BEGIN
  IF event_kind IS NULL OR event_kind NOT IN ('expired','async_failed') OR event_id IS NULL OR length(event_id) = 0 THEN
    RAISE EXCEPTION 'Invalid session outcome';
  END IF;
  SELECT * INTO o FROM commerce_orders WHERE id = oid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable'; END IF;
  SELECT * INTO q FROM commerce_quotes WHERE id = o.quote_id;
  IF o.provider_session_id IS NULL OR sid IS DISTINCT FROM o.provider_session_id OR
     amount IS DISTINCT FROM q.total_cents OR event_currency IS DISTINCT FROM q.currency OR
     (o.provider_payment_id IS NOT NULL AND pid IS DISTINCT FROM o.provider_payment_id) THEN
    RAISE EXCEPTION 'Session outcome does not match order';
  END IF;
  IF EXISTS(SELECT 1 FROM commerce_payment_events WHERE provider_event_id = event_id) THEN
    RAISE EXCEPTION 'Conflicting event replay';
  END IF;
  SELECT * INTO previous FROM commerce_session_events WHERE provider_event_id = event_id;
  IF FOUND THEN
    IF previous.order_id IS DISTINCT FROM oid OR previous.session_id IS DISTINCT FROM sid OR
       previous.kind IS DISTINCT FROM event_kind OR previous.payment_id IS DISTINCT FROM pid OR
       previous.amount_cents IS DISTINCT FROM amount OR previous.currency IS DISTINCT FROM event_currency THEN
      RAISE EXCEPTION 'Conflicting event replay';
    END IF;
    RETURN o;
  END IF;
  INSERT INTO commerce_session_events(provider_event_id,order_id,session_id,kind,payment_id,amount_cents,currency)
    VALUES(event_id,oid,sid,event_kind,pid,amount,event_currency);
  -- Existing paid/refunded outcomes are never downgraded by delayed failures.
  -- Coupon reservations are derived from pending status, so this atomically
  -- releases an unpaid order reservation without decrementing paid usage.
  IF o.status = 'pending' THEN
    UPDATE commerce_orders SET status = 'failed', updated_at = now() WHERE id = oid RETURNING * INTO o;
  END IF;
  RETURN o;
END $$;
