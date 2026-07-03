-- Add crowd & counter to feature_kind for databases created before these
-- plugins existed. init.sql already has them for fresh installs; this is the
-- forward migration for an existing data dir. Idempotent (PostgreSQL 12+).
ALTER TYPE feature_kind ADD VALUE IF NOT EXISTS 'crowd';
ALTER TYPE feature_kind ADD VALUE IF NOT EXISTS 'counter';
