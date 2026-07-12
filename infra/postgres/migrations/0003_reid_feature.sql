-- Cross-camera re-identification (staff exclusion + visitor dedup) is a
-- toggleable tenant feature like the rest of the plugins.
ALTER TYPE feature_kind ADD VALUE IF NOT EXISTS 'reid';
