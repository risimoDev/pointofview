-- ViziAI schema bootstrap (dev). Runs once on empty data dir.

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Enums ───────────────────────────────────────────────────
CREATE TYPE tenant_mode    AS ENUM ('cloud','onpremise');
CREATE TYPE camera_source  AS ENUM ('rtsp_pull','srt_push','file');
CREATE TYPE camera_status  AS ENUM ('online','offline','error');
CREATE TYPE zone_kind      AS ENUM ('counter','desk','shelf','queue','forbidden','required_ppe');
CREATE TYPE event_type     AS ENUM ('zone_entry','zone_exit','zone_violation','queue_alert',
                                    'ppe_violation','repack_event','shelf_violation','crowd',
                                    'unknown_person','camera_offline','camera_online');
CREATE TYPE event_severity AS ENUM ('info','warn','critical');
CREATE TYPE user_role      AS ENUM ('super','admin','manager','operator');
CREATE TYPE feature_kind   AS ENUM ('ppe','face_id','shelf','repack','queue','crowd','counter');

-- ── Multitenancy ────────────────────────────────────────────
CREATE TABLE tenant (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name     text NOT NULL,
  mode     tenant_mode NOT NULL DEFAULT 'cloud',
  settings jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE site (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name      text NOT NULL,
  address   text,
  timezone  text NOT NULL DEFAULT 'Europe/Moscow'
);
CREATE INDEX idx_site_tenant ON site(tenant_id);

-- ── Cameras & zones ─────────────────────────────────────────
CREATE TABLE camera (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id     uuid NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_type camera_source NOT NULL DEFAULT 'rtsp_pull',
  url_main    text,                       -- архив
  url_sub     text,                       -- AI-анализ
  status      camera_status NOT NULL DEFAULT 'offline',
  config      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_camera_site ON camera(site_id);

CREATE TABLE zone (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id uuid NOT NULL REFERENCES camera(id) ON DELETE CASCADE,
  name      text NOT NULL,
  polygon   jsonb NOT NULL,               -- [[x,y],...] нормализованные 0..1
  kind      zone_kind NOT NULL,
  config    jsonb NOT NULL DEFAULT '{}',  -- dwell_seconds, max_count, ...
  active    boolean NOT NULL DEFAULT true,
  schedule  jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_zone_camera ON zone(camera_id);

-- ── Events (hypertable) ─────────────────────────────────────
CREATE TABLE event (
  id           uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id      uuid NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  camera_id    uuid NOT NULL REFERENCES camera(id) ON DELETE CASCADE,
  zone_id      uuid REFERENCES zone(id) ON DELETE SET NULL,
  type         event_type NOT NULL,
  severity     event_severity NOT NULL DEFAULT 'info',
  track_id     integer,
  ts_start     timestamptz NOT NULL DEFAULT now(),
  ts_end       timestamptz,
  confidence   double precision,
  bbox         jsonb,                      -- {x1,y1,x2,y2}
  meta         jsonb NOT NULL DEFAULT '{}',
  snapshot_key text,
  clip_key     text,
  resolved     boolean NOT NULL DEFAULT false,
  resolved_by  uuid,
  resolved_at  timestamptz,
  PRIMARY KEY (id, ts_start)               -- partition column must be in PK
);
SELECT create_hypertable('event', 'ts_start', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX idx_event_tenant_ts ON event(tenant_id, ts_start DESC);
CREATE INDEX idx_event_camera_ts ON event(camera_id, ts_start DESC);
CREATE INDEX idx_event_type_ts   ON event(type, ts_start DESC);

ALTER TABLE event SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, camera_id',
  timescaledb.compress_orderby   = 'ts_start DESC'
);
SELECT add_compression_policy('event', INTERVAL '7 days');

-- ── Alert rules ─────────────────────────────────────────────
CREATE TABLE alert_rule (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  event_type       event_type NOT NULL,
  conditions       jsonb NOT NULL DEFAULT '{}',
  channels         jsonb NOT NULL DEFAULT '[]',
  cooldown_seconds integer NOT NULL DEFAULT 60,
  enabled          boolean NOT NULL DEFAULT true,
  schedule         jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_alert_rule_tenant ON alert_rule(tenant_id);

-- ── Access ──────────────────────────────────────────────────
CREATE TABLE app_user (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email              text NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  role               user_role NOT NULL DEFAULT 'operator',
  allowed_camera_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_user_tenant ON app_user(tenant_id);

CREATE TABLE audit_log (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id       uuid,
  action        text NOT NULL,
  resource_type text,
  resource_id   uuid,
  details       jsonb NOT NULL DEFAULT '{}',
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
);
SELECT create_hypertable('audit_log', 'created_at', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_audit_tenant_ts ON audit_log(tenant_id, created_at DESC);

-- ── Video archive (metadata; files on /mnt/data/archive) ────
CREATE TABLE archive_segment (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id  uuid NOT NULL REFERENCES camera(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz,
  file_path  text NOT NULL,
  size_bytes bigint
);
CREATE INDEX idx_archive_camera_ts ON archive_segment(camera_id, started_at DESC);

-- ── Per-tenant feature flags ────────────────────────────────
CREATE TABLE tenant_feature (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  feature   feature_kind NOT NULL,
  enabled   boolean NOT NULL DEFAULT false,
  config    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, feature)
);

-- ── Notifications (alert delivery log) ──────────────────────
-- event_id has no FK: event is a hypertable, its id alone is not unique.
CREATE TYPE notification_status AS ENUM ('pending','sent','failed');
CREATE TABLE notifications (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id uuid NOT NULL,
  rule_id  uuid NOT NULL REFERENCES alert_rule(id) ON DELETE CASCADE,
  channel  varchar(32) NOT NULL,
  status   notification_status NOT NULL DEFAULT 'pending',
  error    text,
  sent_at  timestamptz
);
CREATE INDEX idx_notification_event ON notifications(event_id);
CREATE INDEX idx_notification_rule  ON notifications(rule_id);
