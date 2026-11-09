-- ============================================================
-- StrideClash v5.0 - Password hash column
-- ============================================================
-- Rationale:
--   server.ts writes to users.password_hash (register/login paths),
--   but no prior migration declared the column. Without it, every
--   new registration INSERT would fail. Additive only; safe to
--   re-run.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Optional index for faster email lookups during login
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
