-- Camera watchdog events: analyzer heartbeat lost (> threshold) / restored.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'camera_offline';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'camera_online';
