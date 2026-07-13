import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type Redis from 'ioredis'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { db } from '../db/client.js'
import { camera, site, zone } from '../../db/schema.js'
import { config } from '../config.js'
import { writeAudit } from '../audit.js'
import {
  CameraIdParams, CreateCameraBody, CreateZoneBody, UpdateCameraBody,
  UpdateZoneBody, ZoneParams,
} from '../schemas.js'

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'])

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
    tz: site.timezone,
    config: camera.config,
  }).from(camera).innerJoin(site, eq(camera.siteId, site.id))
    .where(eq(site.tenantId, tenantId))
  await app.redis.set(`cameras:${tenantId}`, JSON.stringify(cams))
}

/**
 * go2rtc source string for a camera. One native H264 stream — no transcoding
 * tricks: the browser plays it adaptively via MSE (desktop/Android) or HLS
 * (iOS), both H264 passthrough. RTSP/SRT pass through as-is; a `file` isn't a
 * live stream so it's wrapped in a looping ffmpeg reader (`#input=file` =
 * -re -stream_loop -1 -i ...). Snapshots (`/api/frame.jpeg`) transcode a single
 * frame from the same H264 on demand. go2rtc must have `file` sources mounted at
 * the same path (its /data mount).
 */
function go2rtcSource(src: string, sourceType?: string): string {
  return sourceType === 'file' ? `ffmpeg:${src}#video=h264#input=file` : src
}

/** Register/replace a go2rtc stream named by camera id (MSE/HLS + snapshot). */
async function registerGo2rtc(
  cameraId: string, src: string | null, sourceType?: string,
): Promise<void> {
  if (!src) return
  const base = `${config.GO2RTC_URL}/api/streams`
  const put = `${base}?name=${encodeURIComponent(cameraId)}`
    + `&src=${encodeURIComponent(go2rtcSource(src, sourceType))}`
  try {
    // go2rtc's create is idempotent (won't update an existing stream), so drop
    // any previous registration first to guarantee source changes take effect.
    await fetch(`${base}?src=${encodeURIComponent(cameraId)}`, { method: 'DELETE' })
    await fetch(put, { method: 'PUT' })
  } catch {
    // go2rtc may be down during onboarding; the reconciler re-adds it later
  }
}

/**
 * Re-register go2rtc streams that are missing or drifted from the expected
 * source. go2rtc's stream config is empty on disk (`streams: {}`) and rebuilt at
 * runtime, so every go2rtc restart wipes them — without this the dashboard goes
 * blank until a camera is manually re-saved. Healthy, matching streams are left
 * untouched so we never interrupt an active viewer. Best-effort: a go2rtc outage
 * just retries on the next tick.
 */
export async function reconcileGo2rtc(
  log?: { info?: (o: unknown, m: string) => void },
): Promise<void> {
  let streams: Record<string, { producers?: Array<{ url?: string }> }>
  try {
    const res = await fetch(`${config.GO2RTC_URL}/api/streams`)
    if (!res.ok) return
    streams = await res.json() as typeof streams
  } catch {
    return // go2rtc down; try again on the next tick
  }
  const cams = await db.select({
    id: camera.id, sourceType: camera.sourceType,
    urlMain: camera.urlMain, urlSub: camera.urlSub,
  }).from(camera)
  for (const c of cams) {
    const src = c.urlSub ?? c.urlMain
    if (!src) continue
    const expected = go2rtcSource(src, c.sourceType ?? undefined)
    const urls = streams[c.id]?.producers?.map((p) => p.url) ?? []
    if (urls.length === 1 && urls[0] === expected) continue // already correct
    await registerGo2rtc(c.id, src, c.sourceType ?? undefined)
    log?.info?.({ camera: c.id }, 'go2rtc: (re)registered missing/stale stream')
  }
}

/** Startup + periodic self-heal of go2rtc streams. Returns a stop fn. */
export function startGo2rtcReconciler(
  log?: { info?: (o: unknown, m: string) => void },
): () => void {
  void reconcileGo2rtc(log)
  const timer = setInterval(() => void reconcileGo2rtc(log), 60_000)
  timer.unref?.()
  return () => clearInterval(timer)
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
      schedule: z.schedule,
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
    // Live status from the analyzer heartbeat (camera_alive:{id}, TTL 15s) —
    // the DB column is a manual override only for the sticky `error` state.
    const alive = rows.length > 0
      ? await app.redis.mget(rows.map((r) => `camera_alive:${r.id}`))
      : []
    const items = rows.map((r, i) => ({
      ...r,
      status: alive[i]
        ? 'online' as const
        : (r.status === 'error' ? 'error' as const : 'offline' as const),
    }))
    return { items }
  })

  // Upload a test video → save to the shared dir the analyzer reads, then
  // create a `file` camera pointing at it. The analyzer's camera supervisor
  // picks it up on its next refresh (no worker restart needed).
  app.post('/cameras/upload', {
    preHandler: [app.requireRole('super', 'admin')],
  }, async (req, reply) => {
    let siteId = ''
    let name = ''
    let savedUrl: string | null = null
    let savedDest: string | null = null

    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'site_id') siteId = String(part.value)
          else if (part.fieldname === 'name') name = String(part.value)
        } else if (part.type === 'file') {
          const ext = path.extname(part.filename || '').toLowerCase()
          if (!VIDEO_EXT.has(ext)) {
            part.file.resume() // drain so the request can complete
            return reply.code(400).send({ message: `unsupported video type: ${ext || 'none'}` })
          }
          await mkdir(config.TESTVIDEO_DIR, { recursive: true })
          const fname = `${randomUUID()}${ext}`
          savedDest = path.join(config.TESTVIDEO_DIR, fname)
          await pipeline(part.file, createWriteStream(savedDest))
          if (part.file.truncated) {
            await unlink(savedDest).catch(() => undefined)
            return reply.code(413).send({ message: 'file exceeds upload size limit' })
          }
          // analyzer sees the same dir at TESTVIDEO_DIR (its /data mount)
          savedUrl = `${config.TESTVIDEO_DIR}/${fname}`
        }
      }
    } catch (err) {
      if (savedDest) await unlink(savedDest).catch(() => undefined)
      throw err
    }

    if (!savedUrl) return reply.code(400).send({ message: 'no video file in request' })

    const [s] = await db.select({ id: site.id }).from(site)
      .where(and(eq(site.id, siteId), eq(site.tenantId, req.tenantId))).limit(1)
    if (!s) {
      if (savedDest) await unlink(savedDest).catch(() => undefined)
      return reply.code(400).send({ message: 'site not in tenant' })
    }

    const [row] = await db.insert(camera).values({
      siteId,
      name: name.trim() || 'Загруженное видео',
      sourceType: 'file',
      urlSub: savedUrl,
      status: 'online',
    }).returning()

    await syncCameras(app, req.tenantId)
    await registerGo2rtc(row!.id, savedUrl, 'file') // browser video + zone-editor snapshot
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'camera.upload',
      resourceType: 'camera', resourceId: row!.id, details: { name: row!.name },
    })
    return reply.code(201).send(row)
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
    await registerGo2rtc(row!.id, row!.urlSub ?? row!.urlMain, row!.sourceType)
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
    await registerGo2rtc(row!.id, row!.urlSub ?? row!.urlMain, row!.sourceType)
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
    // clean up per-camera Redis state so the dashboard doesn't keep a ghost row
    await app.redis.hdel(`occupancy:${req.tenantId}`, id)
    await app.redis.del(`zones:${id}`, `camera_last_seen:${id}`, `camera_down:${id}`)
    try {
      await fetch(`${config.GO2RTC_URL}/api/streams?src=${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch {
      // go2rtc may be down; stream will be replaced on next onboarding anyway
    }
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'camera.delete',
      resourceType: 'camera', resourceId: id,
    })
    return { deleted: true }
  })

  app.get('/cameras/:id/zones', {
    preHandler: [app.authenticate],
    schema: { params: CameraIdParams },
  }, async (req, reply) => {
    const { id } = req.params
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }
    const rows = await db.select().from(zone).where(eq(zone.cameraId, id))
    return { items: rows }
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

  app.patch('/cameras/:id/zones/:zoneId', {
    preHandler: [app.authenticate],
    schema: { params: ZoneParams, body: UpdateZoneBody },
  }, async (req, reply) => {
    const { id, zoneId } = req.params
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }
    const b = req.body
    const patch: {
      name?: string
      kind?: 'counter' | 'desk' | 'shelf' | 'queue' | 'forbidden' | 'required_ppe'
      polygon?: [number, number][]; config?: Record<string, unknown>
      active?: boolean; schedule?: Record<string, unknown>
    } = {}
    if (b.name !== undefined) patch.name = b.name
    if (b.kind !== undefined) patch.kind = b.kind
    if (b.polygon !== undefined) patch.polygon = b.polygon
    if (b.config !== undefined) patch.config = b.config
    if (b.active !== undefined) patch.active = b.active
    if (b.schedule !== undefined) patch.schedule = b.schedule
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ message: 'nothing to update' })
    }
    const [row] = await db.update(zone).set(patch)
      .where(and(eq(zone.id, zoneId), eq(zone.cameraId, id))).returning()
    if (!row) return reply.code(404).send({ message: 'zone not found' })
    await syncZones(app, id)
    return row
  })

  app.delete('/cameras/:id/zones/:zoneId', {
    preHandler: [app.authenticate],
    schema: { params: ZoneParams },
  }, async (req, reply) => {
    const { id, zoneId } = req.params
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }
    const [row] = await db.delete(zone)
      .where(and(eq(zone.id, zoneId), eq(zone.cameraId, id)))
      .returning({ id: zone.id })
    if (!row) return reply.code(404).send({ message: 'zone not found' })
    await syncZones(app, id)
    return { deleted: true }
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
