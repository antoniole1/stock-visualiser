-- Populate created_at for existing portfolios that are missing this field
-- This sets created_at to the current timestamp for any portfolio where it's NULL

UPDATE portfolios
SET created_at = now()
WHERE created_at IS NULL;
