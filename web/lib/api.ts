import {
  CamerasSchema,
  EventsPageSchema,
  ZoneSchema,
  type Camera,
  type EventsPage,
  type Zone,
} from '@shared/events.schema'
import { z } from 'zod'

// JWT lives in an httpOnly cookie; this route handler echoes it back so the
// client can attach Authorization headers and the WebSocket token.
let tokenPromise: Promise<string> | null = null

export async function getToken(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = fetch('/api/auth/token', { credentials: 'include' }).then(async (r) => {
      if (!r.ok) throw new Error('unauthenticated')
      const { token } = (await r.json()) as { token: string }
      return token
    })
  }
  return tokenPromise
}

export function resetToken(): void {
  tokenPromise = null
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const res = await fetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    resetToken()
    throw new Error('unauthorized')
  }
  return res
}

async function apiJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return schema.parse(await res.json())
}

export interface EventsFilter {
  camera_id?: string | undefined
  type?: string | undefined
  severity?: string | undefined
  resolved?: 'true' | 'false' | undefined
  from?: string | undefined
  to?: string | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

export async function getEvents(filter: EventsFilter): Promise<EventsPage> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  return apiJson(`/api/v1/events?${qs.toString()}`, EventsPageSchema)
}

export async function getCameras(): Promise<Camera[]> {
  const data = await apiJson('/api/v1/cameras', CamerasSchema)
  return data.items
}

export async function createCamera(input: {
  site_id: string; name: string; source_type: string
  url_main?: string | null; url_sub?: string | null; config?: Record<string, unknown>
}): Promise<void> {
  const res = await apiFetch('/api/v1/cameras', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createCamera: ${res.status}`)
}

export async function updateCamera(id: string, patch: {
  name?: string; url_main?: string | null; url_sub?: string | null
  status?: string; config?: Record<string, unknown>
}): Promise<void> {
  const res = await apiFetch(`/api/v1/cameras/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`updateCamera: ${res.status}`)
}

export async function deleteCamera(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/cameras/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteCamera: ${res.status}`)
}

// Upload a test video → server creates a `file` camera the analyzer runs.
// Uses XHR (not fetch) to surface upload progress for large files.
export async function uploadVideoCamera(
  file: File,
  siteId: string,
  name: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const token = await getToken()
  const form = new FormData()
  form.append('site_id', siteId)
  form.append('name', name)
  form.append('file', file)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v1/cameras/upload')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e): void => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`upload ${xhr.status}: ${xhr.responseText}`))
    }
    xhr.onerror = (): void => reject(new Error('upload failed (network)'))
    xhr.send(form)
  })
}

export async function getSnapshotObjectUrl(cameraId: string): Promise<string> {
  const res = await apiFetch(`/api/v1/cameras/${cameraId}/snapshot`)
  if (!res.ok) throw new Error(`snapshot: ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

const CreateZoneResult = ZoneSchema
const ZonesListSchema = z.object({ items: z.array(ZoneSchema) })
export interface CreateZoneInput {
  name: string
  kind: Zone['kind']
  polygon: [number, number][]
  config?: Record<string, unknown>
  active?: boolean
}

export async function getZones(cameraId: string): Promise<Zone[]> {
  return (await apiJson(`/api/v1/cameras/${cameraId}/zones`, ZonesListSchema)).items
}

export async function createZone(cameraId: string, input: CreateZoneInput): Promise<Zone> {
  return apiJson(`/api/v1/cameras/${cameraId}/zones`, CreateZoneResult, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updateZone(
  cameraId: string, zoneId: string,
  patch: Partial<CreateZoneInput>,
): Promise<void> {
  const res = await apiFetch(`/api/v1/cameras/${cameraId}/zones/${zoneId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`updateZone: ${res.status}`)
}

export async function deleteZone(cameraId: string, zoneId: string): Promise<void> {
  const res = await apiFetch(`/api/v1/cameras/${cameraId}/zones/${zoneId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteZone: ${res.status}`)
}

export async function resolveEvent(eventId: string): Promise<void> {
  const res = await apiFetch(`/api/v1/events/${eventId}/resolve`, { method: 'PATCH' })
  if (!res.ok) throw new Error(`resolveEvent: ${res.status}`)
}

const SnapshotUrlSchema = z.object({ url: z.string() })
export async function getEventSnapshotUrl(eventId: string): Promise<string | null> {
  const res = await apiFetch(`/api/v1/events/${eventId}/snapshot`)
  if (res.status === 409) return null // событие без снапшота
  if (!res.ok) throw new Error(`snapshot: ${res.status}`)
  return SnapshotUrlSchema.parse(await res.json()).url
}

// ── Analytics overview ────────────────────────────────────────
const OverviewSchema = z.object({
  series: z.array(z.object({ bucket: z.string(), type: z.string(), count: z.number() })),
  byType: z.array(z.object({ type: z.string(), count: z.number(), critical: z.number() })),
  byCamera: z.array(z.object({
    camera_id: z.string(), camera_name: z.string(), count: z.number(),
  })),
  totals: z.object({ total: z.number(), critical: z.number(), unresolved: z.number() }),
  prevTotals: z.object({ total: z.number(), critical: z.number() }),
  dwell: z.array(z.object({
    kind: z.string(), avg_sec: z.number().nullable(), max_sec: z.number().nullable(),
    visits: z.number(),
  })),
  peak: z.array(z.object({
    dow: z.number(), hour: z.number(), count: z.number(),
  })),
  visitorsByDay: z.array(z.object({ day: z.string(), visitors: z.number() })),
  tz: z.string(),
})
export type AnalyticsOverview = z.infer<typeof OverviewSchema>

export async function getAnalyticsOverview(params: {
  from: string; to: string; bucket: 'hour' | 'day'
}): Promise<AnalyticsOverview> {
  const qs = new URLSearchParams(params)
  return apiJson(`/api/v1/analytics/overview?${qs.toString()}`, OverviewSchema)
}

// ── Movement heatmap (analyzer hourly grids over a snapshot) ──
const HeatmapSchema = z.object({
  w: z.number(), h: z.number(), max: z.number(),
  cells: z.array(z.object({ x: z.number(), y: z.number(), c: z.number() })),
})
export type Heatmap = z.infer<typeof HeatmapSchema>

export async function getHeatmap(cameraId: string, hours: number): Promise<Heatmap> {
  return apiJson(
    `/api/v1/cameras/${encodeURIComponent(cameraId)}/heatmap?hours=${hours}`,
    HeatmapSchema,
  )
}

export async function requestClip(eventId: string): Promise<void> {
  const res = await apiFetch(`/api/v1/events/${eventId}/clip`, { method: 'POST' })
  if (res.status !== 202 && !res.ok) throw new Error(`clip request: ${res.status}`)
}

const TicketSchema = z.object({ ticket: z.string() })
export async function getWsTicket(): Promise<string> {
  return (await apiJson('/api/v1/ws-ticket', TicketSchema)).ticket
}

const ClipUrlSchema = z.object({ url: z.string() })
export async function getClipUrl(eventId: string): Promise<string | null> {
  const res = await apiFetch(`/api/v1/events/${eventId}/clip`)
  if (res.status === 409) return null // not ready yet
  if (!res.ok) throw new Error(`clip: ${res.status}`)
  return ClipUrlSchema.parse(await res.json()).url
}

// ── Safety reports (охрана труда) ─────────────────────────────
const SafetyReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  tz: z.string(),
  siteName: z.string().nullable(),
  totals: z.object({
    total: z.number(),
    critical: z.number(),
    resolved: z.number(),
    avg_resolve_min: z.number().nullable(),
  }),
  byDay: z.array(z.object({ day: z.string(), count: z.number(), critical: z.number() })),
  byType: z.array(z.object({ type: z.string(), count: z.number(), critical: z.number() })),
  byZone: z.array(z.object({ zone_name: z.string(), count: z.number(), critical: z.number() })),
  byCamera: z.array(z.object({ camera_name: z.string(), count: z.number() })),
  recent: z.array(z.object({
    id: z.string(),
    ts_start: z.string(),
    type: z.string(),
    severity: z.string(),
    camera_name: z.string(),
    zone_name: z.string().nullable(),
    resolved: z.boolean(),
  })),
  modelVersions: z.array(z.string()),
})
export type SafetyReport = z.infer<typeof SafetyReportSchema>

function reportParams(from: string, to: string, siteId?: string): string {
  const p = new URLSearchParams({ from, to })
  if (siteId) p.set('site_id', siteId)
  return p.toString()
}

export async function getSafetyReport(
  from: string, to: string, siteId?: string,
): Promise<SafetyReport> {
  return apiJson(`/api/v1/reports/safety?${reportParams(from, to, siteId)}`, SafetyReportSchema)
}

// Auth is a Bearer header (not a cookie), so a plain <a href> can't download —
// fetch the blob and hand it to the browser as a synthetic link.
export async function downloadSafetyReport(
  kind: 'pdf' | 'xlsx', from: string, to: string, siteId?: string,
): Promise<void> {
  const res = await apiFetch(`/api/v1/reports/safety.${kind}?${reportParams(from, to, siteId)}`)
  if (!res.ok) throw new Error(`report ${kind}: ${res.status}`)
  const blob = await res.blob()
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
    ?? `safety.${kind}`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export async function sendSafetyReportTelegram(
  from: string, to: string, siteId?: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/v1/reports/safety/telegram?${reportParams(from, to, siteId)}`,
    { method: 'POST' },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `telegram: ${res.status}`)
  }
}

// ── Feature flags ─────────────────────────────────────────────
const FeatureSchema = z.object({
  feature: z.string(),
  enabled: z.boolean(),
  config: z.record(z.unknown()),
})
const FeaturesSchema = z.object({ items: z.array(FeatureSchema) })
export type Feature = z.infer<typeof FeatureSchema>

export async function getFeatures(): Promise<Feature[]> {
  return (await apiJson('/api/v1/features', FeaturesSchema)).items
}

// Analyzer-side model/plugin state (loaded / off / error / vram_exceeded)
const PluginStatusSchema = z.object({
  feature_id: z.string(),
  state: z.string(),
  version: z.string(),
  model: z.string().nullable(),
  vram_mb: z.number().nullable(),
  error: z.string().nullable(),
  ts: z.number(),
})
const FeatureStatusSchema = z.object({
  items: z.array(PluginStatusSchema),
  metrics: z.object({
    infer_ms: z.number().optional(),
    detector: z.string().optional(),
    cameras: z.number().optional(),
    vram_allocated_mb: z.number().optional(),
    vram_total_mb: z.number().optional(),
  }).nullable(),
})
export type PluginStatus = z.infer<typeof PluginStatusSchema>
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>

export async function getFeatureStatus(): Promise<FeatureStatus> {
  return apiJson('/api/v1/features/status', FeatureStatusSchema)
}

export async function setFeature(
  feature: string,
  enabled: boolean,
  config: Record<string, unknown> = {},
): Promise<void> {
  const res = await apiFetch(`/api/v1/features/${feature}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, config }),
  })
  if (!res.ok) throw new Error(`setFeature: ${res.status}`)
}

// ── Live occupancy (counter plugin) ───────────────────────────
// per-camera «сейчас» + per-site «за день» (посетители дедуплицируются reid)
const OccupancySchema = z.object({
  items: z.array(z.object({
    cameraId: z.string(),
    occupancy: z.number(),
    ts: z.number(),
  })),
  sites: z.array(z.object({
    siteId: z.string(),
    siteName: z.string(),
    visitors: z.number(),
    ts: z.number(),
  })),
})
export type OccupancyData = z.infer<typeof OccupancySchema>
export type Occupancy = OccupancyData['items'][number]

export async function getOccupancy(): Promise<OccupancyData> {
  return apiJson('/api/v1/occupancy', OccupancySchema)
}

// ── People (reid): staff roster + recent visitors ─────────────
const PersonSchema = z.object({
  gid: z.string(),
  staff: z.boolean(),
  name: z.string().nullable(),
  lastSeen: z.number().nullable(),
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  snapshotUrl: z.string(),
  clothingSamples: z.number(),
  faceSamples: z.number(),
  facePhotos: z.number(),
  faceFailed: z.number(),
})
const PeopleSchema = z.object({ items: z.array(PersonSchema) })
export type Person = z.infer<typeof PersonSchema>

export async function getPeople(): Promise<Person[]> {
  return (await apiJson('/api/v1/people', PeopleSchema)).items
}

/** Create a staff member from scratch; face photos are uploaded afterwards. */
export async function createStaff(name: string): Promise<string> {
  const res = await apiFetch('/api/v1/people/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`createStaff: ${res.status}`)
  return ((await res.json()) as { gid: string }).gid
}

export async function setPersonStaff(
  gid: string, staff: boolean, name?: string, mergeInto?: string,
): Promise<void> {
  const body: Record<string, unknown> = { staff }
  if (name !== undefined) body.name = name
  if (mergeInto !== undefined) body.merge_into = mergeInto
  const res = await apiFetch(`/api/v1/people/${encodeURIComponent(gid)}/staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`setPersonStaff: ${res.status}`)
}

export async function uploadFacePhoto(gid: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('photo', file)
  const res = await apiFetch(`/api/v1/people/${encodeURIComponent(gid)}/face-photo`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`uploadFacePhoto: ${res.status}`)
}

export async function deletePerson(gid: string): Promise<void> {
  const res = await apiFetch(`/api/v1/people/${encodeURIComponent(gid)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deletePerson: ${res.status}`)
}

// ── Role (decoded from the JWT payload; UX gating only) ───────
export async function getRole(): Promise<string | null> {
  try {
    const token = await getToken()
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch {
    return null
  }
}

// Full JWT claims for UX gating (real enforcement is server-side)
export interface Claims {
  role: string | null
  perms: string[] | null   // null = role defaults
  imp: boolean             // super entered an org from the platform section
}
export async function getClaims(): Promise<Claims> {
  try {
    const token = await getToken()
    const payload = token.split('.')[1]
    if (!payload) return { role: null, perms: null, imp: false }
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const p = JSON.parse(json) as { role?: string; perms?: string[] | null; imp?: boolean }
    return { role: p.role ?? null, perms: p.perms ?? null, imp: Boolean(p.imp) }
  } catch {
    return { role: null, perms: null, imp: false }
  }
}

// ── Super-admin: diagnostics ──────────────────────────────────
const HealthSchema = z.object({
  services: z.record(z.string()),
  streams: z.object({
    events: z.object({ name: z.string(), length: z.number() }),
    failed: z.object({ name: z.string(), length: z.number() }),
    group: z.object({ name: z.string(), pending: z.number(), lag: z.number() }).nullable(),
  }),
  ts: z.number(),
})
export type Health = z.infer<typeof HealthSchema>

export async function getHealth(): Promise<Health> {
  return apiJson('/api/v1/admin/health', HealthSchema)
}

const DeadLetterSchema = z.object({
  items: z.array(z.object({ id: z.string(), data: z.string(), error: z.string() })),
})
export type DeadLetterEntry = z.infer<typeof DeadLetterSchema>['items'][number]

export async function getDeadLetter(count = 50): Promise<DeadLetterEntry[]> {
  return (await apiJson(`/api/v1/admin/dead-letter?count=${count}`, DeadLetterSchema)).items
}

export async function replayDeadLetter(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/admin/dead-letter/${encodeURIComponent(id)}/replay`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`replay: ${res.status}`)
}

// ── Super-admin: organization (sites + users) ─────────────────
const AdminSiteSchema = z.object({
  id: z.string(), tenantId: z.string(), name: z.string(),
  address: z.string().nullable(), timezone: z.string(),
})
const AdminSitesSchema = z.object({ items: z.array(AdminSiteSchema) })
export type AdminSite = z.infer<typeof AdminSiteSchema>

export async function getSites(): Promise<AdminSite[]> {
  return (await apiJson('/api/v1/admin/sites', AdminSitesSchema)).items
}
export async function createSite(input: {
  name: string; address?: string | null; timezone?: string
}): Promise<void> {
  const res = await apiFetch('/api/v1/admin/sites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createSite: ${res.status}`)
}

const AdminUserSchema = z.object({
  id: z.string(), email: z.string(), name: z.string(), role: z.string(),
  allowedCameraIds: z.array(z.string()),
  permissions: z.array(z.string()).nullable(),
  disabled: z.boolean(),
})
const AdminUsersSchema = z.object({ items: z.array(AdminUserSchema) })
export type AdminUser = z.infer<typeof AdminUserSchema>

export interface UserInput {
  email?: string
  password?: string
  name?: string
  role?: string
  permissions?: string[] | null
  allowed_camera_ids?: string[]
  disabled?: boolean
}

export async function getUsers(): Promise<AdminUser[]> {
  return (await apiJson('/api/v1/admin/users', AdminUsersSchema)).items
}
export async function createUser(input: UserInput): Promise<void> {
  const res = await apiFetch('/api/v1/admin/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createUser: ${res.status}`)
}
export async function updateUser(id: string, patch: UserInput): Promise<void> {
  const res = await apiFetch(`/api/v1/admin/users/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`updateUser: ${res.status}`)
}
export async function deleteUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/admin/users/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteUser: ${res.status}`)
}

// ── Invites (owner sends the link; employee sets the password) ─
const InviteSchema = z.object({
  id: z.string(), token: z.string(), name: z.string(),
  email: z.string().nullable(), role: z.string(),
  permissions: z.array(z.string()).nullable(),
  allowedCameraIds: z.array(z.string()),
  createdAt: z.string(), expiresAt: z.string(), usedAt: z.string().nullable(),
})
export type Invite = z.infer<typeof InviteSchema>

export async function getInvites(): Promise<Invite[]> {
  return (await apiJson('/api/v1/admin/invites',
    z.object({ items: z.array(InviteSchema) }))).items
}
export async function createInvite(input: {
  name?: string; email?: string; role?: string
  permissions?: string[] | null; allowed_camera_ids?: string[]
}): Promise<string> {
  const res = await apiFetch('/api/v1/admin/invites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createInvite: ${res.status}`)
  return ((await res.json()) as { token: string }).token
}
export async function deleteInvite(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/admin/invites/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteInvite: ${res.status}`)
}

// ── Platform (super, cross-tenant) ────────────────────────────
const OrgSchema = z.object({
  id: z.string(), name: z.string(), mode: z.string(),
  sites: z.number(), cameras: z.number(), users: z.number(),
})
export type Org = z.infer<typeof OrgSchema>

export async function getOrgs(): Promise<Org[]> {
  return (await apiJson('/api/v1/platform/orgs', z.object({ items: z.array(OrgSchema) }))).items
}
export async function createOrg(input: {
  name: string; mode?: string; site_name?: string; owner_name?: string
}): Promise<{ id: string; owner_invite_token: string }> {
  const res = await apiFetch('/api/v1/platform/orgs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createOrg: ${res.status}`)
  return (await res.json()) as { id: string; owner_invite_token: string }
}
/** Swap the session into the target org (keeps the super token to return). */
export async function enterOrg(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/platform/orgs/${id}/enter`, { method: 'POST' })
  if (!res.ok) throw new Error(`enterOrg: ${res.status}`)
  const { token } = (await res.json()) as { token: string }
  const swap = await fetch('/api/auth/enter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!swap.ok) throw new Error(`enterOrg swap: ${swap.status}`)
}
export async function leaveOrg(): Promise<void> {
  const res = await fetch('/api/auth/leave', { method: 'POST' })
  if (!res.ok) throw new Error(`leaveOrg: ${res.status}`)
}

// ── Super-admin: alert rules ──────────────────────────────────
const AlertRuleSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  channels: z.array(z.record(z.unknown())),
  cooldownSeconds: z.number(),
  enabled: z.boolean(),
  conditions: z.record(z.unknown()),
  schedule: z.record(z.unknown()),
})
const AlertRulesSchema = z.object({ items: z.array(AlertRuleSchema) })
export type AlertRule = z.infer<typeof AlertRuleSchema>

export interface AlertRuleInput {
  event_type: string
  channels: Record<string, unknown>[]
  cooldown_seconds: number
  enabled: boolean
  conditions?: Record<string, unknown>
  schedule?: Record<string, unknown>
}

export async function testAlertRule(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/admin/alert-rules/${id}/test`, { method: 'POST' })
  if (res.status !== 202 && !res.ok) throw new Error(`testAlertRule: ${res.status}`)
}

export async function getAlertRules(): Promise<AlertRule[]> {
  return (await apiJson('/api/v1/admin/alert-rules', AlertRulesSchema)).items
}
export async function createAlertRule(input: AlertRuleInput): Promise<void> {
  const res = await apiFetch('/api/v1/admin/alert-rules', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`createAlertRule: ${res.status}`)
}
export async function updateAlertRule(id: string, patch: Partial<AlertRuleInput>): Promise<void> {
  const res = await apiFetch(`/api/v1/admin/alert-rules/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`updateAlertRule: ${res.status}`)
}
export async function deleteAlertRule(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/admin/alert-rules/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteAlertRule: ${res.status}`)
}

// ── Super-admin: video-test event simulation ──────────────────
export async function simulateEvent(input: {
  camera_id: string; type: string; severity?: string
  zone_id?: string | null; meta?: Record<string, unknown>
}): Promise<void> {
  const res = await apiFetch('/api/v1/admin/simulate/event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`simulateEvent: ${res.status}`)
}

// ── Super-admin: maintenance ──────────────────────────────────
const AuditSchema = z.object({
  items: z.array(z.object({
    id: z.string(), action: z.string(),
    resourceType: z.string().nullable(), resourceId: z.string().nullable(),
    createdAt: z.string(),
  })),
})
export type AuditEntry = z.infer<typeof AuditSchema>['items'][number]
export async function getAudit(count = 50): Promise<AuditEntry[]> {
  return (await apiJson(`/api/v1/admin/audit?count=${count}`, AuditSchema)).items
}

const ResyncSchema = z.object({ cameras: z.number(), features: z.number(), zones: z.number() })
export async function resync(): Promise<z.infer<typeof ResyncSchema>> {
  const res = await apiFetch('/api/v1/admin/resync', { method: 'POST' })
  if (!res.ok) throw new Error(`resync: ${res.status}`)
  return ResyncSchema.parse(await res.json())
}

export async function clearDeadLetter(): Promise<number> {
  const res = await apiFetch('/api/v1/admin/dead-letter/clear', { method: 'POST' })
  if (!res.ok) throw new Error(`clearDeadLetter: ${res.status}`)
  return z.object({ cleared: z.number() }).parse(await res.json()).cleared
}

const TimescaleSchema = z.object({ event: z.object({ chunks: z.number(), compressed: z.number() }) })
export async function getTimescale(): Promise<z.infer<typeof TimescaleSchema>> {
  return apiJson('/api/v1/admin/timescale', TimescaleSchema)
}

// ── Server settings (/admin/settings) ─────────────────────────
const ServerSettingSchema = z.object({
  key: z.string(),
  group: z.string(),
  type: z.enum(['number', 'boolean', 'secret', 'text']),
  label: z.string(),
  hint: z.string().nullable(),
  value: z.union([z.number(), z.boolean(), z.string()]),
  def: z.union([z.number(), z.boolean(), z.string()]),
  overridden: z.boolean(),
})
const ServerSettingsSchema = z.object({ items: z.array(ServerSettingSchema) })
export type ServerSetting = z.infer<typeof ServerSettingSchema>

export async function getServerSettings(): Promise<ServerSetting[]> {
  return (await apiJson('/api/v1/admin/settings', ServerSettingsSchema)).items
}

export async function saveServerSettings(patch: Record<string, unknown>): Promise<void> {
  const res = await apiFetch('/api/v1/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `saveServerSettings: ${res.status}`)
  }
}

const SystemInfoSchema = z.object({
  archiveDisk: z.object({ totalGb: z.number(), freeGb: z.number() }).nullable(),
  dbSizeBytes: z.number(),
  eventCount: z.number(),
  archive: z.object({
    segments: z.number(),
    bytes: z.number(),
    oldest: z.string().nullable(),
    newest: z.string().nullable(),
  }),
  lastBackup: z.object({
    ok: z.boolean(),
    ts: z.number(),
    pg_bytes: z.number().optional(),
    redis_bytes: z.number().optional(),
    error: z.string().optional(),
  }).nullable(),
  uptimeSec: z.number(),
  node: z.string(),
})
export type SystemInfo = z.infer<typeof SystemInfoSchema>

export async function getSystemInfo(): Promise<SystemInfo> {
  return apiJson('/api/v1/admin/system', SystemInfoSchema)
}
