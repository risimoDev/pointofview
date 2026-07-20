-- Operator feedback: mark an event as a false positive. Feeds the VLM
-- verification gate and the fine-tuning dataset; excluded from safety reports.
ALTER TABLE event ADD COLUMN IF NOT EXISTS false_positive boolean NOT NULL DEFAULT false;
