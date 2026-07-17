-- Pose/fall detection plugin: new feature kind + event type.
ALTER TYPE feature_kind ADD VALUE IF NOT EXISTS 'pose';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'fall_detected';
