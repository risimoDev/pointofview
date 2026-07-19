-- Lone-worker (работа в одиночку) safety events: emitted by CrowdPlugin when
-- a zone with config.min_people has fewer people than required.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'lone_worker';
