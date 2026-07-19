import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { sql, eq, and, desc } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '../db/client.js'
import {
  site, appUser, alertRule, camera, zone, tenantFeature, auditLog, userInvite,
} from '../../db/schema.js'
import { randomBytes } from 'node:crypto'
import { writeAudit } from '../audit.js'
import { EventTypeEnum, SeverityEnum } from '../schemas.js'
import { PermissionCodes, sanitizePerms } from '../permissions.js'
import { config } from '../config.js'
import { CLIPS_BUCKET, minio } from '../minio.js'
import { alertsQueue } from '../queues.js'
import { SETTING_DEFS, loadSettings, saveSetting } from '../settings.js'
import { statfs } from 'node:fs/promises'

const RoleEnum = z.enum(['super', 'admin', 'manager', 'operator'])
// roles a tenant owner may assign — never 'super' (privilege escalation)
const TenantRoleEnum = z.enum(['admin', 'manager', 'operator'])
const PermsField = z.array(z.enum(PermissionCodes)).nullable().optional()
const AlertRuleBody = z.object({
  event_type: EventTypeEnum,
  channels: z.array(z.record(z.unknown())).default([]),
  cooldown_seconds: z.number().int().min(1).default(60),
  enabled: z.boolean().default(true),
  // { min_severity: 'info'|'warn'|'critical' }
  conditions: z.record(z.unknown()).default({}),
  // { quiet_from: 'HH:MM', quiet_to: 'HH:MM' } — тихие часы в TZ точки
  schedule: z.record(z.unknown()).default({}),
})

function flatToObj(arr: unknown[]): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (let i = 0; i + 1 < arr.length; i += 2) o[String(arr[i])] = arr[i + 1]
  return o
}

/** Super-admin only. Diagnostics + dead-letter replay. Real security is here;
 *  the web /admin gate is UX only. */
const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const requireSuper = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await app.authenticate(req)
    if (req.role !== 'super') {
      await reply.code(403).send({ message: 'super role required' })
    }
  }
  // tenant-owner scope: владелец предприятия (admin), super — для помощи,
  // либо сотрудник с галочкой «Пользователи»
  const requireUsersPerm = app.requirePerm('users')
  const requireAlertsPerm = app.requirePerm('alerts')
  const requireOwner = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await app.authenticate(req)
    if (req.role !== 'super' && req.role !== 'admin') {
      await reply.code(403).send({ message: 'owner role required' })
    }
  }

  app.get('/health', { preHandler: [requireSuper] }, async () => {
    const services: Record<string, 'ok' | 'error'> = {}
    try { await db.execute(sql`select 1`); services.postgres = 'ok' } catch { services.postgres = 'error' }
    try { await app.redis.ping(); services.redis = 'ok' } catch { services.redis = 'error' }
    try { await minio.bucketExists(CLIPS_BUCKET); services.minio = 'ok' } catch { services.minio = 'error' }

    let eventsLen = 0
    let failedLen = 0
    try { eventsLen = await app.redis.xlen(config.EVENTS_STREAM) } catch { /* stream may not exist yet */ }
    try { failedLen = await app.redis.xlen(config.FAILED_STREAM) } catch { /* idem */ }

    let group: { name: string; pending: number; lag: number } | null = null
    try {
      const groups = (await app.redis.xinfo('GROUPS', config.EVENTS_STREAM)) as unknown[][]
      const g = groups.map(flatToObj).find((x) => x.name === config.CONSUMER_GROUP)
      if (g) group = { name: String(g.name), pending: Number(g.pending ?? 0), lag: Number(g.lag ?? 0) }
    } catch { /* group not created yet */ }

    return {
      services,
      streams: {
        events: { name: config.EVENTS_STREAM, length: eventsLen },
        failed: { name: config.FAILED_STREAM, length: failedLen },
        group,
      },
      ts: Date.now(),
    }
  })

  app.get('/dead-letter', {
    preHandler: [requireSuper],
    schema: { querystring: z.object({ count: z.coerce.number().int().min(1).max(200).default(50) }) },
  }, async (req) => {
    const entries = (await app.redis.xrevrange(
      config.FAILED_STREAM, '+', '-', 'COUNT', req.query.count,
    )) as [string, string[]][]
    const items = entries.map(([id, fields]) => {
      const f = flatToObj(fields)
      return { id, data: String(f.data ?? ''), error: String(f.error ?? '') }
    })
    return { items }
  })

  app.post('/dead-letter/:id/replay', {
    preHandler: [requireSuper],
    schema: { params: z.object({ id: z.string().min(1) }) },
  }, async (req, reply) => {
    const { id } = req.params
    const entries = (await app.redis.xrange(config.FAILED_STREAM, id, id)) as [string, string[]][]
    const entry = entries[0]
    if (!entry) return reply.code(404).send({ message: 'entry not found' })
    const data = String(flatToObj(entry[1]).data ?? '')
    if (!data) return reply.code(400).send({ message: 'entry has no data field' })
    await app.redis.xadd(config.EVENTS_STREAM, '*', 'data', data)
    await app.redis.xdel(config.FAILED_STREAM, id)
    return { replayed: true, id }
  })

  // ── Organization: sites (tenant-scoped) ─────────────────────
  app.get('/sites', { preHandler: [requireOwner] }, async (req) => {
    const rows = await db.select().from(site).where(eq(site.tenantId, req.tenantId))
    return { items: rows }
  })

  app.post('/sites', {
    preHandler: [requireOwner],
    schema: {
      body: z.object({
        name: z.string().min(1),
        address: z.string().nullable().optional(),
        timezone: z.string().default('Europe/Moscow'),
      }),
    },
  }, async (req, reply) => {
    const b = req.body
    const [row] = await db.insert(site).values({
      tenantId: req.tenantId, name: b.name, address: b.address ?? null, timezone: b.timezone,
    }).returning()
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'site.create',
      resourceType: 'site', resourceId: row!.id, details: { name: b.name },
    })
    return reply.code(201).send(row)
  })

  // ── Organization: users (tenant-scoped; владелец или галочка «users») ──
  const userCols = {
    id: appUser.id, email: appUser.email, name: appUser.name, role: appUser.role,
    allowedCameraIds: appUser.allowedCameraIds, permissions: appUser.permissions,
    disabled: appUser.disabled,
  }

  app.get('/users', { preHandler: [requireUsersPerm] }, async (req) => {
    const rows = await db.select(userCols).from(appUser)
      .where(eq(appUser.tenantId, req.tenantId))
    return { items: rows }
  })

  app.post('/users', {
    preHandler: [requireUsersPerm],
    schema: {
      body: z.object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().trim().max(80).default(''),
        role: TenantRoleEnum.default('operator'),
        permissions: PermsField,
        allowed_camera_ids: z.array(z.string().uuid()).default([]),
      }),
    },
  }, async (req, reply) => {
    const b = req.body
    const passwordHash = await bcrypt.hash(b.password, 10)
    try {
      const [row] = await db.insert(appUser).values({
        tenantId: req.tenantId, email: b.email, passwordHash, role: b.role,
        name: b.name, permissions: sanitizePerms(b.permissions),
        allowedCameraIds: b.allowed_camera_ids,
      }).returning(userCols)
      await writeAudit({
        tenantId: req.tenantId, userId: req.userId, action: 'user.create',
        resourceType: 'user', resourceId: row!.id, details: { email: b.email, role: b.role },
      })
      return reply.code(201).send(row)
    } catch {
      return reply.code(409).send({ message: 'email already exists' })
    }
  })

  app.patch('/users/:id', {
    preHandler: [requireUsersPerm],
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        role: TenantRoleEnum.optional(),
        password: z.string().min(8).optional(),
        name: z.string().trim().max(80).optional(),
        permissions: PermsField,
        allowed_camera_ids: z.array(z.string().uuid()).optional(),
        disabled: z.boolean().optional(),
      }),
    },
  }, async (req, reply) => {
    // a super account can never be edited through the tenant-owner endpoint
    const [target] = await db.select({ role: appUser.role }).from(appUser)
      .where(and(eq(appUser.id, req.params.id), eq(appUser.tenantId, req.tenantId))).limit(1)
    if (!target) return reply.code(404).send({ message: 'user not found' })
    if (target.role === 'super' && req.role !== 'super') {
      return reply.code(403).send({ message: 'cannot edit a super account' })
    }
    const b = req.body
    const patch: {
      role?: z.infer<typeof TenantRoleEnum>; passwordHash?: string; name?: string
      permissions?: string[] | null; allowedCameraIds?: string[]; disabled?: boolean
    } = {}
    if (b.role) patch.role = b.role
    if (b.password) patch.passwordHash = await bcrypt.hash(b.password, 10)
    if (b.name !== undefined) patch.name = b.name
    if (b.permissions !== undefined) patch.permissions = sanitizePerms(b.permissions)
    if (b.allowed_camera_ids !== undefined) patch.allowedCameraIds = b.allowed_camera_ids
    if (b.disabled !== undefined && req.params.id !== req.userId) patch.disabled = b.disabled
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ message: 'nothing to update' })
    }
    const [row] = await db.update(appUser).set(patch)
      .where(and(eq(appUser.id, req.params.id), eq(appUser.tenantId, req.tenantId)))
      .returning(userCols)
    if (!row) return reply.code(404).send({ message: 'user not found' })
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'user.update',
      resourceType: 'user', resourceId: req.params.id,
      details: { role: b.role, disabled: b.disabled, permissions: b.permissions },
    })
    return row
  })

  app.delete('/users/:id', {
    preHandler: [requireUsersPerm],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req, reply) => {
    if (req.params.id === req.userId) {
      return reply.code(400).send({ message: 'cannot delete yourself' })
    }
    const [target] = await db.select({ role: appUser.role }).from(appUser)
      .where(and(eq(appUser.id, req.params.id), eq(appUser.tenantId, req.tenantId))).limit(1)
    if (!target) return reply.code(404).send({ message: 'user not found' })
    if (target.role === 'super' && req.role !== 'super') {
      return reply.code(403).send({ message: 'cannot delete a super account' })
    }
    await db.delete(appUser)
      .where(and(eq(appUser.id, req.params.id), eq(appUser.tenantId, req.tenantId)))
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'user.delete',
      resourceType: 'user', resourceId: req.params.id,
    })
    return { deleted: true }
  })

  // ── Invites: link with pre-set capabilities, employee sets the password ──
  app.get('/invites', { preHandler: [requireUsersPerm] }, async (req) => {
    const rows = await db.select({
      id: userInvite.id, token: userInvite.token, name: userInvite.name,
      email: userInvite.email, role: userInvite.role,
      permissions: userInvite.permissions, allowedCameraIds: userInvite.allowedCameraIds,
      createdAt: userInvite.createdAt, expiresAt: userInvite.expiresAt,
      usedAt: userInvite.usedAt,
    }).from(userInvite).where(eq(userInvite.tenantId, req.tenantId))
      .orderBy(desc(userInvite.createdAt)).limit(50)
    return { items: rows }
  })

  app.post('/invites', {
    preHandler: [requireUsersPerm],
    schema: {
      body: z.object({
        name: z.string().trim().max(80).default(''),
        email: z.string().email().optional(),
        role: TenantRoleEnum.default('operator'),
        permissions: PermsField,
        allowed_camera_ids: z.array(z.string().uuid()).default([]),
        expires_days: z.number().int().min(1).max(30).default(7),
      }),
    },
  }, async (req, reply) => {
    const b = req.body
    const token = randomBytes(24).toString('base64url')
    const [row] = await db.insert(userInvite).values({
      tenantId: req.tenantId, token, name: b.name, email: b.email ?? null,
      role: b.role, permissions: sanitizePerms(b.permissions),
      allowedCameraIds: b.allowed_camera_ids, createdBy: req.userId,
      expiresAt: new Date(Date.now() + b.expires_days * 86_400_000),
    }).returning({ id: userInvite.id, token: userInvite.token })
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'invite.create',
      resourceType: 'invite', resourceId: row!.id, details: { name: b.name, role: b.role },
    })
    return reply.code(201).send(row)
  })

  app.delete('/invites/:id', {
    preHandler: [requireUsersPerm],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(userInvite)
      .where(and(eq(userInvite.id, req.params.id), eq(userInvite.tenantId, req.tenantId)))
      .returning({ id: userInvite.id })
    if (!row) return reply.code(404).send({ message: 'invite not found' })
    return { deleted: true }
  })

  // ── Alert rules (tenant-scoped) ─────────────────────────────
  app.get('/alert-rules', { preHandler: [requireAlertsPerm] }, async (req) => {
    const rows = await db.select().from(alertRule).where(eq(alertRule.tenantId, req.tenantId))
    return { items: rows }
  })

  app.post('/alert-rules', {
    preHandler: [requireAlertsPerm],
    schema: { body: AlertRuleBody },
  }, async (req, reply) => {
    const b = req.body
    const [row] = await db.insert(alertRule).values({
      tenantId: req.tenantId, eventType: b.event_type, channels: b.channels,
      cooldownSeconds: b.cooldown_seconds, enabled: b.enabled,
      conditions: b.conditions, schedule: b.schedule,
    }).returning()
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'alert_rule.create',
      resourceType: 'alert_rule', resourceId: row!.id, details: { event_type: b.event_type },
    })
    return reply.code(201).send(row)
  })

  app.patch('/alert-rules/:id', {
    preHandler: [requireAlertsPerm],
    schema: { params: z.object({ id: z.string().uuid() }), body: AlertRuleBody.partial() },
  }, async (req, reply) => {
    const b = req.body
    const patch: {
      eventType?: z.infer<typeof EventTypeEnum>; channels?: unknown[]
      cooldownSeconds?: number; enabled?: boolean
      conditions?: Record<string, unknown>; schedule?: Record<string, unknown>
    } = {}
    if (b.event_type !== undefined) patch.eventType = b.event_type
    if (b.channels !== undefined) patch.channels = b.channels
    if (b.cooldown_seconds !== undefined) patch.cooldownSeconds = b.cooldown_seconds
    if (b.enabled !== undefined) patch.enabled = b.enabled
    if (b.conditions !== undefined) patch.conditions = b.conditions
    if (b.schedule !== undefined) patch.schedule = b.schedule
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ message: 'nothing to update' })
    }
    const [row] = await db.update(alertRule).set(patch)
      .where(and(eq(alertRule.id, req.params.id), eq(alertRule.tenantId, req.tenantId)))
      .returning()
    if (!row) return reply.code(404).send({ message: 'rule not found' })
    return row
  })

  // «Отправить тестовое» — synthetic message to the rule's channels via the
  // same worker path as real alerts (validates token/chat_id/webhook end-to-end)
  app.post('/alert-rules/:id/test', {
    preHandler: [requireAlertsPerm],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req, reply) => {
    const [rule] = await db.select({ id: alertRule.id }).from(alertRule)
      .where(and(eq(alertRule.id, req.params.id), eq(alertRule.tenantId, req.tenantId)))
      .limit(1)
    if (!rule) return reply.code(404).send({ message: 'rule not found' })
    await alertsQueue.add('test', {
      event_id: '', tenant_id: req.tenantId, test_rule_id: rule.id,
    }, { removeOnComplete: 20, removeOnFail: 50 })
    return reply.code(202).send({ queued: true })
  })

  app.delete('/alert-rules/:id', {
    preHandler: [requireAlertsPerm],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(alertRule)
      .where(and(eq(alertRule.id, req.params.id), eq(alertRule.tenantId, req.tenantId)))
      .returning({ id: alertRule.id })
    if (!row) return reply.code(404).send({ message: 'rule not found' })
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'alert_rule.delete',
      resourceType: 'alert_rule', resourceId: req.params.id,
    })
    return { deleted: true }
  })

  // ── Video-test: inject a synthetic event into the real pipeline ──
  // Drives the full downstream (consumer → DB → WS → alerts) without the GPU
  // analyzer. camera_id resolves site_id; tenant from the JWT.
  app.post('/simulate/event', {
    preHandler: [requireAlertsPerm],
    schema: {
      body: z.object({
        camera_id: z.string().uuid(),
        type: EventTypeEnum,
        severity: SeverityEnum.default('warn'),
        zone_id: z.string().uuid().nullable().optional(),
        meta: z.record(z.unknown()).optional(),
      }),
    },
  }, async (req, reply) => {
    const b = req.body
    const [cam] = await db.select({ siteId: camera.siteId }).from(camera)
      .innerJoin(site, eq(camera.siteId, site.id))
      .where(and(eq(camera.id, b.camera_id), eq(site.tenantId, req.tenantId))).limit(1)
    if (!cam) return reply.code(404).send({ message: 'camera not found' })

    const payload = {
      stream: 'events',
      tenant_id: req.tenantId,
      site_id: cam.siteId,
      camera_id: b.camera_id,
      zone_id: b.zone_id ?? null,
      type: b.type,
      severity: b.severity,
      track_id: Math.floor(Math.random() * 1000),
      confidence: 0.9,
      bbox: null,
      meta: { ...(b.meta ?? {}), simulated: true },
      ts_start: new Date().toISOString(),
      ts_end: null,
    }
    await app.redis.xadd(config.EVENTS_STREAM, '*', 'data', JSON.stringify(payload))
    return { queued: true }
  })

  // ── Maintenance ─────────────────────────────────────────────
  app.get('/audit', {
    preHandler: [requireSuper],
    schema: { querystring: z.object({ count: z.coerce.number().int().min(1).max(200).default(50) }) },
  }, async (req) => {
    const rows = await db.select({
      id: auditLog.id, action: auditLog.action, resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId, createdAt: auditLog.createdAt,
    }).from(auditLog).where(eq(auditLog.tenantId, req.tenantId))
      .orderBy(desc(auditLog.createdAt)).limit(req.query.count)
    return { items: rows }
  })

  // Rebuild Redis state the analyzer/zone_engine read (cameras/features/zones).
  app.post('/resync', { preHandler: [requireSuper] }, async (req) => {
    const cams = await db.select({
      id: camera.id, site_id: camera.siteId, source_type: camera.sourceType,
      url_main: camera.urlMain, url_sub: camera.urlSub, tz: site.timezone,
      config: camera.config,
    }).from(camera).innerJoin(site, eq(camera.siteId, site.id))
      .where(eq(site.tenantId, req.tenantId))
    await app.redis.set(`cameras:${req.tenantId}`, JSON.stringify(cams))

    const feats = await db.select({
      feature: tenantFeature.feature, enabled: tenantFeature.enabled, config: tenantFeature.config,
    }).from(tenantFeature).where(eq(tenantFeature.tenantId, req.tenantId))
    const fobj: Record<string, unknown> = {}
    for (const f of feats) fobj[f.feature] = { enabled: f.enabled, config: f.config }
    await app.redis.set(`features:${req.tenantId}`, JSON.stringify(fobj))

    let zoneCount = 0
    for (const c of cams) {
      const zs = await db.select().from(zone).where(eq(zone.cameraId, c.id))
      const key = `zones:${c.id}`
      const pipe = app.redis.pipeline()
      pipe.del(key)
      for (const zz of zs) {
        pipe.hset(key, zz.id, JSON.stringify({
          id: zz.id, name: zz.name, kind: zz.kind, polygon: zz.polygon,
          config: zz.config, active: zz.active, schedule: zz.schedule,
        }))
        zoneCount++
      }
      await pipe.exec()
    }
    return { cameras: cams.length, features: feats.length, zones: zoneCount }
  })

  app.post('/dead-letter/clear', { preHandler: [requireSuper] }, async () => {
    const cleared = await app.redis.xlen(config.FAILED_STREAM)
    await app.redis.del(config.FAILED_STREAM)
    return { cleared }
  })

  // ── Server settings (/admin/settings) ───────────────────────
  app.get('/settings', { preHandler: [requireSuper] }, async () => {
    const values = await loadSettings(true)
    const items = SETTING_DEFS.map((d) => ({
      key: d.key,
      group: d.group,
      type: d.type,
      label: d.label,
      hint: d.hint ?? null,
      // secrets never leave the server; the UI only sees whether one is set
      value: d.type === 'secret'
        ? (typeof values[d.key] === 'string' && values[d.key] !== '' ? '•••••' : '')
        : (values[d.key] ?? d.def),
      def: d.type === 'secret' ? '' : d.def,
      overridden: values[d.key] !== undefined,
    }))
    return { items }
  })

  app.put('/settings', {
    preHandler: [requireSuper],
    schema: { body: z.record(z.unknown()) },
  }, async (req, reply) => {
    const saved: string[] = []
    for (const [key, value] of Object.entries(req.body)) {
      try {
        await saveSetting(key, value)
        saved.push(key)
      } catch (err) {
        return reply.code(400).send({
          message: err instanceof Error ? err.message : `invalid setting: ${key}`,
        })
      }
    }
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'settings.update',
      resourceType: 'settings', details: { keys: saved },
    })
    return { saved }
  })

  // ── System panel: disk / DB / archive usage ──────────────────
  app.get('/system', { preHandler: [requireSuper] }, async () => {
    let archiveDisk: { totalGb: number; freeGb: number } | null = null
    try {
      const s = await statfs(config.ARCHIVE_ROOT)
      archiveDisk = {
        totalGb: Math.round((s.blocks * s.bsize) / 1024 ** 3 * 10) / 10,
        freeGb: Math.round((s.bavail * s.bsize) / 1024 ** 3 * 10) / 10,
      }
    } catch { /* archive dir not mounted (dev) */ }

    const dbRes = await db.execute(sql`SELECT pg_database_size(current_database()) AS size`)
    const dbSizeBytes = Number((dbRes.rows[0] as { size?: unknown } | undefined)?.size ?? 0)

    const evRes = await db.execute(sql`SELECT count(*) AS n FROM event`)
    const eventCount = Number((evRes.rows[0] as { n?: unknown } | undefined)?.n ?? 0)

    const arRes = await db.execute(sql`
      SELECT count(*) AS n, coalesce(sum(size_bytes), 0) AS bytes,
             min(started_at) AS oldest, max(started_at) AS newest
      FROM archive_segment
    `)
    const ar = (arRes.rows[0] ?? {}) as {
      n?: unknown; bytes?: unknown; oldest?: unknown; newest?: unknown
    }

    // written by scripts/backup.sh after each run
    let lastBackup: Record<string, unknown> | null = null
    try {
      const raw = await app.redis.get('backup:last')
      if (raw) lastBackup = JSON.parse(raw) as Record<string, unknown>
    } catch { /* no backup status yet */ }

    return {
      archiveDisk,
      dbSizeBytes,
      eventCount,
      archive: {
        segments: Number(ar.n ?? 0),
        bytes: Number(ar.bytes ?? 0),
        oldest: ar.oldest ? String(ar.oldest) : null,
        newest: ar.newest ? String(ar.newest) : null,
      },
      lastBackup,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
    }
  })

  app.get('/timescale', { preHandler: [requireSuper] }, async () => {
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'event') AS chunks,
        (SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'event' AND is_compressed) AS compressed
    `)
    const row = (res.rows[0] ?? {}) as { chunks?: unknown; compressed?: unknown }
    return { event: { chunks: Number(row.chunks ?? 0), compressed: Number(row.compressed ?? 0) } }
  })
}

export default adminRoutes
