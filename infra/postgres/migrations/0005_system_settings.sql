-- Server-wide settings editable from /admin/settings (fallback = env defaults).
CREATE TABLE IF NOT EXISTS system_setting (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
