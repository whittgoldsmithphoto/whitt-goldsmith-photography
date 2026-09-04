ALTER TABLE catalog_galleries
  ADD COLUMN customer_instructions text NOT NULL DEFAULT '' CHECK (length(customer_instructions)<=4000),
  ADD COLUMN download_policy text NOT NULL DEFAULT 'none' CHECK (download_policy IN ('none','purchased_only'));
-- Declarative customer policy only. Neither value grants original access.
-- Before a customer download route can be enabled, its entitlement gate must
-- enforce this field in addition to confirmed payment, expiry and revocation.
