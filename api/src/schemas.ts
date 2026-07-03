import { z } from 'zod'

// must stay in sync with DB enums (init.sql / db/schema.ts)
export const EventTypeEnum = z.enum([
  'zone_entry', 'zone_exit', 'zone_violation', 'queue_alert', 'ppe_violation',
  'repack_event', 'shelf_violation', 'crowd', 'unknown_person',
])
export const SeverityEnum = z.enum(['info', 'warn', 'critical'])
export const SourceTypeEnum = z.enum(['rtsp_pull', 'srt_push', 'file'])
export const ZoneKindEnum = z.enum([
  'counter', 'desk', 'shelf', 'queue', 'forbidden', 'required_ppe',
])
export const FeatureKindEnum = z.enum([
  'ppe', 'face_id', 'shelf', 'repack', 'queue', 'crowd', 'counter',
])

export const BboxSchema = z.object({
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
})

// Incoming Redis Stream `events` payload (from zone_engine / plugins)
export const EventMessageSchema = z.object({
  stream: z.literal('events').optional(),
  tenant_id: z.string().uuid(),
  site_id: z.string().uuid(),
  camera_id: z.string().uuid(),
  zone_id: z.string().uuid().nullable().optional(),
  type: EventTypeEnum,
  severity: SeverityEnum,
  track_id: z.number().int().nullable().optional(),
  confidence: z.number().nullable().optional(),
  bbox: BboxSchema.nullable().optional(),
  meta: z.record(z.unknown()).optional(),
  ts_start: z.string(),
  ts_end: z.string().nullable().optional(),
})
export type EventMessage = z.infer<typeof EventMessageSchema>

// ── Route IO ──────────────────────────────────────────────────
export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const EventsQuery = z.object({
  camera_id: z.string().uuid().optional(),
  type: EventTypeEnum.optional(),
  severity: SeverityEnum.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().datetime().optional(), // ts_start of last seen row
})

export const CreateCameraBody = z.object({
  site_id: z.string().uuid(),
  name: z.string().min(1),
  source_type: SourceTypeEnum.default('rtsp_pull'),
  url_main: z.string().nullable().optional(),
  url_sub: z.string().nullable().optional(),
  config: z.record(z.unknown()).default({}),
})

export const CameraIdParams = z.object({ id: z.string().uuid() })

export const UpdateCameraBody = z.object({
  name: z.string().min(1).optional(),
  url_main: z.string().nullable().optional(),
  url_sub: z.string().nullable().optional(),
  status: z.enum(['online', 'offline', 'error']).optional(),
  config: z.record(z.unknown()).optional(),
})

export const CreateZoneBody = z.object({
  name: z.string().min(1),
  kind: ZoneKindEnum,
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  config: z.record(z.unknown()).default({}),
  active: z.boolean().default(true),
  schedule: z.record(z.unknown()).default({}),
})

export const SummaryQuery = z.object({
  site_id: z.string().uuid(),
  from: z.string().datetime(),
  to: z.string().datetime(),
})

export const EventIdParams = z.object({ id: z.string().uuid() })

// ── Feature flags ─────────────────────────────────────────────
export const FeatureParams = z.object({ feature: FeatureKindEnum })
export const UpsertFeatureBody = z.object({
  enabled: z.boolean(),
  config: z.record(z.unknown()).default({}),
})

// recorder → POST /internal/segments
export const SegmentBody = z.object({
  tenant_id: z.string().uuid(),
  camera_id: z.string().uuid(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable().optional(),
  file_path: z.string().min(1),
  size_bytes: z.number().int().nonnegative().nullable().optional(),
})
