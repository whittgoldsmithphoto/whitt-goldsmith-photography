-- Provider calls happen outside transactions. One immutable request per local order.
CREATE TABLE commerce_checkout_attempts (
  order_id text PRIMARY KEY REFERENCES commerce_orders(id),
  account_id text NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
  origin text NOT NULL,
  environment text NOT NULL CHECK (environment='staging'),
  params jsonb NOT NULL CHECK (jsonb_typeof(params)='object'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  provider_session_id text UNIQUE,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','bound','cancel_requested','expired','complete')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CHECK (provider_session_id IS NULL OR provider_session_id LIKE 'cs_test_%')
);
CREATE INDEX commerce_checkout_attempts_reconciliation ON commerce_checkout_attempts(state,expires_at,order_id)
  WHERE state IN ('reserved','bound','cancel_requested');
CREATE INDEX commerce_orders_customer_history ON commerce_orders(customer_id,created_at DESC,id DESC);
CREATE FUNCTION commerce_checkout_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.order_id,NEW.account_id,NEW.origin,NEW.environment,NEW.params,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.order_id,OLD.account_id,OLD.origin,OLD.environment,OLD.params,OLD.expires_at,OLD.created_at)
    OR (OLD.provider_session_id IS NOT NULL AND NEW.provider_session_id IS DISTINCT FROM OLD.provider_session_id)
    OR (OLD.state IN ('cancel_requested','expired','complete') AND NEW.state IN ('reserved','bound'))
  THEN RAISE EXCEPTION 'Checkout request and terminal lifecycle are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_checkout_attempt_immutable BEFORE UPDATE ON commerce_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION commerce_checkout_attempt_immutable();
