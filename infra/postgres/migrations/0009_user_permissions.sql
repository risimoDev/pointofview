-- Enterprise user management: capability checkboxes + invites.
-- permissions NULL = legacy role defaults (admin=all, manager/operator subsets).
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS permissions jsonb;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  email text,
  role user_role NOT NULL DEFAULT 'operator',
  permissions jsonb,
  allowed_camera_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_invite_tenant ON user_invite (tenant_id);
