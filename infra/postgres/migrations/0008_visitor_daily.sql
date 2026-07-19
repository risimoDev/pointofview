-- Daily visitor counts per site, snapshotted from Redis visitors:{tenant}
-- every ~10 min by the API (the Redis counter only holds the current day).
CREATE TABLE IF NOT EXISTS visitor_daily (
  site_id uuid NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  day date NOT NULL,
  visitors int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, day)
);
