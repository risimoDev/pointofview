-- Camera tampering detection + movement heatmap plugins.
ALTER TYPE feature_kind ADD VALUE IF NOT EXISTS 'tamper';
ALTER TYPE feature_kind ADD VALUE IF NOT EXISTS 'heatmap';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'camera_tampered';
