-- Rollback admin role support (drops column + related objects).

BEGIN;

DROP INDEX IF EXISTS users_role_idx;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
END $$;

ALTER TABLE users
  DROP COLUMN IF EXISTS role;

COMMIT;

