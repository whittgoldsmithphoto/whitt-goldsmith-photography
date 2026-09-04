-- Pricing configuration only. Existing quote/fulfillment functions continue to
-- reject everything except individual digital photos.
ALTER TABLE commerce_products DROP CONSTRAINT commerce_products_kind_check;
ALTER TABLE commerce_products ADD CONSTRAINT commerce_products_kind_check
  CHECK (kind IN ('digital_photo','gallery_download','print'));
ALTER TABLE commerce_products ADD COLUMN finish text;
ALTER TABLE commerce_products ADD CONSTRAINT commerce_print_configuration_check
  CHECK (kind <> 'print' OR (
    width_inches IS NOT NULL AND width_inches > 0 AND
    height_inches IS NOT NULL AND height_inches > 0 AND
    finish IS NOT NULL AND length(trim(finish)) BETWEEN 1 AND 80
  )) NOT VALID;
-- NOT VALID preserves legacy print rows for owner remediation; all new writes
-- must supply complete specifications. Do not silently invent their finish.
