-- ViziAI dev seed. Idempotent. Login: admin@viziai.local / admin12345
-- tenant_id matches analyzer default TENANT_ID (all-zero uuid).

INSERT INTO tenant (id, name, mode) VALUES
  ('00000000-0000-0000-0000-000000000000', 'Demo PVZ', 'cloud')
ON CONFLICT (id) DO NOTHING;

INSERT INTO site (id, tenant_id, name) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'PVZ #1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_user (id, tenant_id, email, password_hash, role) VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000',
   'admin@viziai.local',
   '$2a$10$vog8l.Ne4DM7SPlSIm/T9ueCojOvxkzQATYsZ7NlaI9TXJJLWNgdO', 'admin'),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000',
   'super@viziai.local',
   '$2a$10$AuMseeBAvqiLba6Zj1bTduOcRS9G05LM4dmQ5i3OPeO13W.MT3J.W', 'super')
ON CONFLICT (email) DO NOTHING;

INSERT INTO camera (id, site_id, name, source_type, url_sub, status) VALUES
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010',
   'Cam Demo', 'file', '/data/sample.mp4', 'offline')
ON CONFLICT (id) DO NOTHING;

INSERT INTO zone (id, camera_id, name, polygon, kind, config) VALUES
  ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030',
   'Counter', '[[0.4,0.4],[0.9,0.4],[0.9,0.9],[0.4,0.9]]', 'counter', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_feature (tenant_id, feature, enabled, config) VALUES
  ('00000000-0000-0000-0000-000000000000', 'crowd',   true, '{"max_count":5}'),
  ('00000000-0000-0000-0000-000000000000', 'counter', true, '{"interval_seconds":30}')
ON CONFLICT (tenant_id, feature) DO UPDATE
  SET enabled = EXCLUDED.enabled, config = EXCLUDED.config;
