import { z } from 'zod'

// ── Shared enums ──────────────────────────────────────────────
export const EventType = z.enum([
  'zone_entry', 'zone_exit', 'zone_violation', 'queue_alert', 'ppe_violation',
  'repack_event', 'shelf_violation', 'crowd', 'unknown_person',
  'camera_offline', 'camera_online',
])
export const Severity = z.enum(['info', 'warn', 'critical'])
export const SourceType = z.enum(['rtsp_pull', 'srt_push', 'file'])
export const CameraStatus = z.enum(['online', 'offline', 'error'])
export const ZoneKind = z.enum([
  'counter', 'desk', 'shelf', 'queue', 'forbidden', 'required_ppe',
])

export const BboxSchema = z.object({
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
})

// ── Redis Stream `events` payload (snake_case, also pushed over WS) ──
export const StreamEventSchema = z.object({
  stream: z.literal('events').optional(),
  tenant_id: z.string().uuid(),
  site_id: z.string().uuid(),
  camera_id: z.string().uuid(),
  zone_id: z.string().uuid().nullable().optional(),
  type: EventType,
  severity: Severity,
  track_id: z.number().int().nullable().optional(),
  confidence: z.number().nullable().optional(),
  bbox: BboxSchema.nullable().optional(),
  meta: z.record(z.unknown()).optional(),
  ts_start: z.string(),
  ts_end: z.string().nullable().optional(),
})
export type StreamEvent = z.infer<typeof StreamEventSchema>

// ── REST `event` row (camelCase, from Drizzle select) ─────────
export const ApiEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  siteId: z.string().uuid(),
  cameraId: z.string().uuid(),
  zoneId: z.string().uuid().nullable(),
  type: EventType,
  severity: Severity,
  trackId: z.number().int().nullable(),
  tsStart: z.string(),
  tsEnd: z.string().nullable(),
  confidence: z.number().nullable(),
  bbox: BboxSchema.nullable(),
  meta: z.record(z.unknown()),
  snapshotKey: z.string().nullable(),
  clipKey: z.string().nullable(),
  resolved: z.boolean(),
  // joined display names (null if the camera/zone was deleted)
  cameraName: z.string().nullable(),
  zoneName: z.string().nullable(),
})
export type ApiEvent = z.infer<typeof ApiEventSchema>

export const EventsPageSchema = z.object({
  items: z.array(ApiEventSchema),
  nextCursor: z.string().nullable(),
})
export type EventsPage = z.infer<typeof EventsPageSchema>

export const CameraSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  name: z.string(),
  sourceType: SourceType,
  urlMain: z.string().nullable(),
  urlSub: z.string().nullable(),
  status: CameraStatus,
  config: z.record(z.unknown()),
})
export type Camera = z.infer<typeof CameraSchema>
export const CamerasSchema = z.object({ items: z.array(CameraSchema) })

export const ZoneSchema = z.object({
  id: z.string().uuid(),
  cameraId: z.string().uuid(),
  name: z.string(),
  kind: ZoneKind,
  polygon: z.array(z.tuple([z.number(), z.number()])),
  config: z.record(z.unknown()),
  active: z.boolean(),
  schedule: z.record(z.unknown()),
})
export type Zone = z.infer<typeof ZoneSchema>

// ── UI-normalized event (both REST and WS funnel into this) ───
export interface UiEvent {
  id: string | null
  cameraId: string
  zoneId: string | null
  type: z.infer<typeof EventType>
  severity: z.infer<typeof Severity>
  tsStart: string
  snapshotKey: string | null
  clipKey: string | null
}

export function fromApiEvent(e: ApiEvent): UiEvent {
  return {
    id: e.id, cameraId: e.cameraId, zoneId: e.zoneId, type: e.type,
    severity: e.severity, tsStart: e.tsStart,
    snapshotKey: e.snapshotKey, clipKey: e.clipKey,
  }
}

export function fromStreamEvent(e: StreamEvent): UiEvent {
  return {
    id: null, cameraId: e.camera_id, zoneId: e.zone_id ?? null, type: e.type,
    severity: e.severity, tsStart: e.ts_start, snapshotKey: null, clipKey: null,
  }
}
