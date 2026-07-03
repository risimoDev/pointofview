-- Adds the notifications table (alert delivery log) to an existing DB.
-- Idempotent: safe to re-run.

DO $$ BEGIN
  CREATE TYPE notification_status AS ENUM ('pending','sent','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS notifications (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id uuid NOT NULL,
  rule_id  uuid NOT NULL REFERENCES alert_rule(id) ON DELETE CASCADE,
  channel  varchar(32) NOT NULL,
  status   notification_status NOT NULL DEFAULT 'pending',
  error    text,
  sent_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notification_event ON notifications(event_id);
CREATE INDEX IF NOT EXISTS idx_notification_rule  ON notifications(rule_id);
