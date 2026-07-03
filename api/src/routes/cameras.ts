import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type Redis from 'ioredis'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { camera, site, zone } from '../../db/schema.js'
import { config } from '../config.js'
import { writeAudit } from '../audit.js'
import { CameraIdParams, CreateCameraBody, CreateZoneBody, UpdateCameraBody } from '../schemas.js'

/** Verify a camera belongs to the caller's tenant. */
async function ownsCamera(tenantId: string, cameraId: string): Promise<boolean> {
  const [row] = await db.select({ id: camera.id }).from(camera)
    .innerJoin(site, eq(camera.siteId, site.id))
    .where(and(eq(camera.id, cameraId), eq(site.tenantId, tenantId))).limit(1)
  return Boolean(row)
}

/** Rebuild Redis cameras:{tenant} array consumed by the analyzer. */
async function syncCameras(app: { redis: Redis }, tenantId: string): Promise<void> {
  const cams = await db.select({
    id: camera.id,
    site_id: camera.siteId,
    source_type: camera.sourceType,
    url_main: camera.urlMain,
    url_sub: camera.urlSub,
    config: camera.config,
  }).from(camera).innerJoin(site, eq(camera.siteId, site.id))
    .where(eq(site.tenantId, tenantId))
  await app.redis.set(`cameras:${tenantId}`, JSON.stringify(cams))
}

/** Register/replace a go2rtc stream named by camera id (for WHEP + snapshot). */
async function registerGo2rtc(cameraId: string, src: string | null): Promise<void> {
  if (!src) return
  const url = `${config.GO2RTC_URL}/api/streams?name=${encodeURIComponent(cameraId)}`
    + `&src=${encodeURIComponent(src)}`
  try {
    await fetch(url, { method: 'PUT' })
  } catch {
    // go2rtc may be down during onboarding; analyzer/snapshot will retry later
  }
}

/** Rebuild Redis zones:{camera} hash consumed by zone_engine. */
async function syncZones(app: { redis: Redis }, cameraId: string): Promise<void> {
  const zs = await db.select().from(zone).where(eq(zone.cameraId, cameraId))
  const key = `zones:${cameraId}`
  const pipe = app.redis.pipeline()
  pipe.del(key)
  for (const z of zs) {
    pipe.hset(key, z.id, JSON.stringify({
      id: z.id, name: z.name, kind: z.kind,
      polygon: z.polygon, config: z.config, active: z.active,
    }))
  }
  await pipe.exec()
}

const camerasRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/cameras', {
    preHandler: [app.authenticate],
  }, async (req) => {
    const rows = await db.select({
      id: camera.id, siteId: camera.siteId, name: camera.name,
      sourceType: camera.sourceType, urlMain: camera.urlMain,
      urlSub: camera.urlSub, status: camera.status, config: camera.config,
    }).from(camera).innerJoin(site, eq(camera.siteId, site.id))
      .where(eq(site.tenantId, req.tenantId))
    return { items: rows }
  })

  app.post('/cameras', {
    preHandler: [app.requireRole('super', 'admin')],
    schema: { body: CreateCameraBody },
  }, async (req, reply) => {
    const b = req.body
    // tenant isolation: site must belong to caller's tenant
    const [s] = await db.select({ id: site.id }).from(site)
      .where(and(eq(site.id, b.site_id), eq(site.tenantId, req.tenantId))).limit(1)
    if (!s) return reply.code(403).send({ message: 'site not in tenant' })

    const [row] = await db.insert(camera).values({
      siteId: b.site_id,
      name: b.name,
      sourceType: b.source_type,
      urlMain: b.url_main ?? null,
      urlSub: b.url_sub ?? null,
      config: b.config,
    }).returning()

    await syncCameras(app, req.tenantId)
    // sub-stream feeds AI/snapshot; fall back to main
    await registerGo2rtc(row!.id, row!.urlSub ?? row!.urlMain)
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'camera.create',
      resourceType: 'camera', resourceId: row!.id, details: { name: b.name },
    })
    return reply.code(201).send(row)
  })

  app.patch('/cameras/:id', {
    preHandler: [app.requireRole('super', 'admin')],
    schema: { params: CameraIdParams, body: UpdateCameraBody },
  }, async (req, reply) => {
    const { id } = req.params
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }
    const b = req.body
    const patch: {
      name?: string; urlMain?: string | null; urlSub?: string | null
      status?: 'online' | 'offline' | 'error'; config?: Record<string, unknown>
    } = {}
    if (b.name !== undefined) patch.name = b.name
    if (b.url_main !== undefined) patch.urlMain = b.url_main
    if (b.url_sub !== undefined) patch.urlSub = b.url_sub
    if (b.status !== undefined) patch.status = b.status
    if (b.config !== undefined) patch.config = b.config
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ message: 'nothing to update' })
    }
    const [row] = await db.update(camera).set(patch).where(eq(camera.id, id)).returning()
    await syncCameras(app, req.tenantId)
    await registerGo2rtc(row!.id, row!.urlSub ?? row!.urlMain)
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'camera.update',
      resourceType: 'camera', resourceId: id, details: patch,
    })
    return row
  })

  app.delete('/cameras/:id', {
    preHandler: [app.requireRole('super', 'admin')],
    schema: { params: CameraIdParams },
  }, async (req, reply) => {
    const { id } = req.params
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }
    await db.delete(camera).where(eq(camera.id, id))
    await syncCameras(app, req.tenantId)
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'camera.delete',
      resourceType: 'camera', resourceId: id,
    })
    return { deleted: true }
  })

  app.post('/cameras/:id/zones', {
    preHandler: [app.authenticate],
    schema: { params: CameraIdParams, body: CreateZoneBody },
  }, async (req, reply) => {
    const { id } = req.params
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }

    const b = req.body
    const [row] = await db.insert(zone).values({
      cameraId: id,
      name: b.name,
      kind: b.kind,
      polygon: b.polygon,
      config: b.config,
      active: b.active,
      schedule: b.schedule,
    }).returning()

    await syncZones(app, id)
    return reply.code(201).send(row)
  })

  // Current frame proxied from go2rtc (binary JPEG passthrough)
  app.get('/cameras/:id/snapshot', {
    preHandler: [app.authenticate],
    schema: { params: CameraIdParams },
  }, async (req, reply) => {
    const { id } = req.params
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }
    const url = `${config.GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(id)}`
    const res = await fetch(url)
    if (!res.ok) {
      return reply.code(502).send({ message: 'snapshot unavailable' })
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'no-store')
      .send(buf)
  })
}

export default camerasRoutes
