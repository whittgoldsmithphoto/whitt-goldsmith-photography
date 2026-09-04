-- One bounded row per authenticated customer; atomic across Worker instances.
CREATE TABLE commerce_checkout_limits (
  customer_id text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 20)
);

CREATE FUNCTION commerce_checkout_attempt(customer text) RETURNS boolean
LANGUAGE sql AS $$
  WITH allowed AS (
    INSERT INTO commerce_checkout_limits(customer_id, attempts) VALUES(customer,1)
    ON CONFLICT(customer_id) DO UPDATE SET
      window_started_at=CASE WHEN commerce_checkout_limits.window_started_at <= now()-interval '10 minutes' THEN now() ELSE commerce_checkout_limits.window_started_at END,
      attempts=CASE WHEN commerce_checkout_limits.window_started_at <= now()-interval '10 minutes' THEN 1 ELSE commerce_checkout_limits.attempts+1 END
    WHERE commerce_checkout_limits.window_started_at <= now()-interval '10 minutes' OR commerce_checkout_limits.attempts<20
    RETURNING customer_id
  ) SELECT EXISTS(SELECT 1 FROM allowed);
$$;
