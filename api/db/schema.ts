import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  jsonb,
  boolean,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  date,
  inet,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core'
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'

// ── Enums ─────────────────────────────────────────────────────
export const deploymentModeEnum = pgEnum('tenant_mode', ['cloud', 'onpremise'])
export const sourceTypeEnum = pgEnum('camera_source', ['rtsp_pull', 'srt_push', 'file'])
export const cameraStatusEnum = pgEnum('camera_status', ['online', 'offline', 'error'])
export const zoneKindEnum = pgEnum('zone_kind', [
  'counter', 'desk', 'shelf', 'queue', 'forbidden', 'required_ppe',
])
export const eventTypeEnum = pgEnum('event_type', [
  'zone_entry', 'zone_exit', 'zone_violation', 'queue_alert', 'ppe_violation',
  'repack_event', 'shelf_violation', 'crowd', 'unknown_person',
  'camera_offline', 'camera_online', 'fall_detected', 'lone_worker',
])
export const eventSeverityEnum = pgEnum('event_severity', ['info', 'warn', 'critical'])
export const userRoleEnum = pgEnum('user_role', ['super', 'admin', 'manager', 'operator'])
export const featureIdEnum = pgEnum('feature_kind',
  ['ppe', 'face_id', 'shelf', 'repack', 'queue', 'crowd', 'counter', 'reid', 'pose'])
export const notificationStatusEnum = pgEnum('notification_status', ['pending', 'sent', 'failed'])

// ── Shared JSON shapes ────────────────────────────────────────
type Bbox = { x1: number; y1: number; x2: number; y2: number }
type Polygon = [number, number][]

// ── Multitenancy ──────────────────────────────────────────────
export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  mode: deploymentModeEnum('mode').notNull().default('cloud'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
})

export const site = pgTable('site', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
}, (t) => [
  index('idx_site_tenant').on(t.tenantId),
])

// ── Cameras & zones ───────────────────────────────────────────
export const camera = pgTable('camera', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourceType: sourceTypeEnum('source_type').notNull().default('rtsp_pull'),
  urlMain: text('url_main'),
  urlSub: text('url_sub'),
  status: cameraStatusEnum('status').notNull().default('offline'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index('idx_camera_site').on(t.siteId),
])

export const zone = pgTable('zone', {
  id: uuid('id').primaryKey().defaultRandom(),
  cameraId: uuid('camera_id').notNull().references(() => camera.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  polygon: jsonb('polygon').$type<Polygon>().notNull(),
  kind: zoneKindEnum('kind').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
  schedule: jsonb('schedule').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index('idx_zone_camera').on(t.cameraId),
])

// ── Events (hypertable; PK includes partition column ts_start) ─
export const event = pgTable('event', {
  id: uuid('id').notNull().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  cameraId: uuid('camera_id').notNull().references(() => camera.id, { onDelete: 'cascade' }),
  zoneId: uuid('zone_id').references(() => zone.id, { onDelete: 'set null' }),
  type: eventTypeEnum('type').notNull(),
  severity: eventSeverityEnum('severity').notNull().default('info'),
  trackId: integer('track_id'),
  tsStart: timestamp('ts_start', { withTimezone: true }).notNull().defaultNow(),
  tsEnd: timestamp('ts_end', { withTimezone: true }),
  confidence: doublePrecision('confidence'),
  bbox: jsonb('bbox').$type<Bbox>(),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  snapshotKey: text('snapshot_key'),
  clipKey: text('clip_key'),
  resolved: boolean('resolved').notNull().default(false),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.id, t.tsStart] }),
  index('idx_event_tenant_ts').on(t.tenantId, t.tsStart.desc()),
  index('idx_event_camera_ts').on(t.cameraId, t.tsStart.desc()),
  index('idx_event_type_ts').on(t.type, t.tsStart.desc()),
])

// ── Alert rules ───────────────────────────────────────────────
export const alertRule = pgTable('alert_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  eventType: eventTypeEnum('event_type').notNull(),
  conditions: jsonb('conditions').$type<Record<string, unknown>>().notNull().default({}),
  channels: jsonb('channels').$type<unknown[]>().notNull().default([]),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(60),
  enabled: boolean('enabled').notNull().default(true),
  schedule: jsonb('schedule').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index('idx_alert_rule_tenant').on(t.tenantId),
])

// ── Access (table `user` is reserved → app_user) ──────────────
export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('operator'),
  allowedCameraIds: uuid('allowed_camera_ids').array().notNull().default([]),
  name: text('name').notNull().default(''),
  // capability checkboxes (shared/events.schema.ts PermissionCodes);
  // null = legacy role defaults
  permissions: jsonb('permissions').$type<string[] | null>(),
  disabled: boolean('disabled').notNull().default(false),
}, (t) => [
  index('idx_user_tenant').on(t.tenantId),
])

// Invite links: the owner creates one with pre-set capabilities, sends the
// link themselves (no email infra needed); the employee sets their password.
export const userInvite = pgTable('user_invite', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  name: text('name').notNull().default(''),
  email: text('email'),
  role: userRoleEnum('role').notNull().default('operator'),
  permissions: jsonb('permissions').$type<string[] | null>(),
  allowedCameraIds: uuid('allowed_camera_ids').array().notNull().default([]),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, (t) => [
  index('idx_invite_tenant').on(t.tenantId),
])

export const auditLog = pgTable('audit_log', {
  id: uuid('id').notNull().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: uuid('resource_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  ip: inet('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.id, t.createdAt] }),
  index('idx_audit_tenant_ts').on(t.tenantId, t.createdAt.desc()),
])

// ── Daily visitor counts (snapshotted from Redis visitors:{tenant}) ──
export const visitorDaily = pgTable('visitor_daily', {
  siteId: uuid('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  visitors: integer('visitors').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.siteId, t.day] }),
])

// ── Video archive (metadata; files on disk) ───────────────────
export const archiveSegment = pgTable('archive_segment', {
  id: uuid('id').primaryKey().defaultRandom(),
  cameraId: uuid('camera_id').notNull().references(() => camera.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  filePath: text('file_path').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
}, (t) => [
  index('idx_archive_camera_ts').on(t.cameraId, t.startedAt.desc()),
])

// ── Per-tenant feature flags ──────────────────────────────────
export const tenantFeature = pgTable('tenant_feature', {
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  feature: featureIdEnum('feature').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.feature] }),
])

// ── Server-wide settings (editable from /admin/settings) ─────
export const systemSetting = pgTable('system_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Notifications (alert delivery log) ────────────────────────
// event_id has no FK: `event` is a hypertable, its `id` alone is not unique
// (PK is composite (id, ts_start)), so it cannot be referenced.
export const notification = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull(),
  ruleId: uuid('rule_id').notNull().references(() => alertRule.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 32 }).notNull(),
  status: notificationStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => [
  index('idx_notification_event').on(t.eventId),
  index('idx_notification_rule').on(t.ruleId),
])

// ── Inferred models ───────────────────────────────────────────
export type Tenant = InferSelectModel<typeof tenant>
export type NewTenant = InferInsertModel<typeof tenant>
export type Site = InferSelectModel<typeof site>
export type NewSite = InferInsertModel<typeof site>
export type Camera = InferSelectModel<typeof camera>
export type NewCamera = InferInsertModel<typeof camera>
export type Zone = InferSelectModel<typeof zone>
export type NewZone = InferInsertModel<typeof zone>
export type Event = InferSelectModel<typeof event>
export type NewEvent = InferInsertModel<typeof event>
export type AlertRule = InferSelectModel<typeof alertRule>
export type NewAlertRule = InferInsertModel<typeof alertRule>
export type AppUser = InferSelectModel<typeof appUser>
export type NewAppUser = InferInsertModel<typeof appUser>
export type AuditLog = InferSelectModel<typeof auditLog>
export type NewAuditLog = InferInsertModel<typeof auditLog>
export type ArchiveSegment = InferSelectModel<typeof archiveSegment>
export type NewArchiveSegment = InferInsertModel<typeof archiveSegment>
export type TenantFeature = InferSelectModel<typeof tenantFeature>
export type NewTenantFeature = InferInsertModel<typeof tenantFeature>
export type Notification = InferSelectModel<typeof notification>
export type NewNotification = InferInsertModel<typeof notification>
export type SystemSetting = InferSelectModel<typeof systemSetting>
