-- Test/live records retain immutable account/environment binding per attempt.
ALTER TABLE commerce_checkout_attempts DROP CONSTRAINT commerce_checkout_attempts_environment_check;
ALTER TABLE commerce_checkout_attempts ADD CONSTRAINT commerce_checkout_attempts_environment_check
  CHECK (environment IN ('staging','production'));
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='commerce_checkout_attempts'::regclass
    AND contype='c' AND pg_get_constraintdef(oid) LIKE '%cs_test_%'
  LOOP EXECUTE format('ALTER TABLE commerce_checkout_attempts DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE commerce_checkout_attempts ADD CONSTRAINT commerce_checkout_mode_session_check
  CHECK (provider_session_id IS NULL OR
    (environment='staging' AND provider_session_id LIKE 'cs_test_%') OR
    (environment='production' AND provider_session_id LIKE 'cs_live_%'));

CREATE TABLE commerce_tax_settlements (
  order_id text PRIMARY KEY REFERENCES commerce_orders(id),
  session_id text NOT NULL UNIQUE,
  base_cents integer NOT NULL CHECK(base_cents>=0),
  tax_cents integer NOT NULL CHECK(tax_cents>=0),
  total_cents integer NOT NULL CHECK(total_cents=base_cents+tax_cents),
  currency text NOT NULL CHECK(currency='usd'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only the verified server adapter calls this function. Provider HTTP calls must
-- finish before this short transaction. Tax and fulfillment commit or roll back
-- together; a failed/replayed payment cannot partially edit quote totals.
CREATE FUNCTION commerce_apply_taxed_payment(eid text, oid text, sid text, pid text,
  outcome text, amount integer, tax integer, event_currency text, is_review boolean)
RETURNS commerce_orders LANGUAGE plpgsql AS $$
DECLARE o commerce_orders; q commerce_quotes; a commerce_checkout_attempts;
  previous commerce_tax_settlements; base integer;
BEGIN
  SELECT * INTO o FROM commerce_orders WHERE id=oid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable'; END IF;
  SELECT * INTO q FROM commerce_quotes WHERE id=o.quote_id FOR UPDATE;
  SELECT * INTO a FROM commerce_checkout_attempts WHERE order_id=o.id;
  base := q.subtotal_cents-q.discount_cents+q.shipping_cents;
  IF a.order_id IS NULL OR a.provider_session_id IS DISTINCT FROM sid OR
    o.provider_session_id IS DISTINCT FROM sid OR sid IS NULL OR
    a.params->'automatic_tax'->>'enabled' IS DISTINCT FROM 'true' OR
    tax IS NULL OR tax<0 OR tax>100000000 OR amount IS DISTINCT FROM base+tax OR
    amount>100000000 OR event_currency IS DISTINCT FROM q.currency OR event_currency<>'usd'
    THEN RAISE EXCEPTION 'Tax settlement identity or amount mismatch'; END IF;
  SELECT * INTO previous FROM commerce_tax_settlements WHERE order_id=oid;
  IF FOUND THEN
    IF ROW(previous.session_id,previous.base_cents,previous.tax_cents,previous.total_cents,previous.currency)
      IS DISTINCT FROM ROW(sid,base,tax,amount,event_currency)
      THEN RAISE EXCEPTION 'Conflicting tax settlement'; END IF;
  ELSE
    INSERT INTO commerce_tax_settlements(order_id,session_id,base_cents,tax_cents,total_cents,currency)
      VALUES(oid,sid,base,tax,amount,event_currency);
    UPDATE commerce_quotes SET tax_cents=tax,total_cents=amount WHERE id=q.id;
  END IF;
  IF is_review THEN
    RETURN commerce_apply_payment_review(eid,oid,sid,pid,outcome,amount,event_currency);
  END IF;
  RETURN commerce_apply_payment(eid,oid,outcome,sid,pid,amount,event_currency);
END $$;
