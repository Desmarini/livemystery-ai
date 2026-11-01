-- Migration-runner metadata. The runner bootstraps this identical definition
-- inside its first transaction so it can record 001_initial.sql safely.
-- This migration remains useful as the versioned schema record for databases
-- created by the runner.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (version ~ '^[0-9]{3,}_[a-z0-9][a-z0-9_-]*$'),
  CHECK (checksum ~ '^[0-9a-f]{64}$')
);
