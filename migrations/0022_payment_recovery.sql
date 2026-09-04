-- Durable event-ID inbox. No payloads, customer data or secrets are retained.
CREATE TABLE commerce_recovery_streams (
  id text PRIMARY KEY,
  window_start integer NOT NULL,
  window_end integer NOT NULL,
  cursor text,
  lease_token text,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(window_end >= window_start)
);
CREATE TABLE commerce_recovery_events (
  stream_id text NOT NULL REFERENCES commerce_recovery_streams(id),
  event_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','review')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(stream_id,event_id)
);
CREATE INDEX commerce_recovery_pending ON commerce_recovery_events(stream_id,next_attempt_at)
  WHERE status='pending';
