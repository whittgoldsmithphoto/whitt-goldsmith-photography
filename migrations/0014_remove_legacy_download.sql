-- Remove the weaker original-key delivery contract. Existing entitlement data remains intact.
DROP FUNCTION IF EXISTS commerce_reserve_download(text,text);
