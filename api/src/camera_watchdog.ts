import type { FastifyBaseLogger } from 'fastify'
import type Redis from 'ioredis'
import { eq, ne } from 'drizzle-orm'
import { db } from './db/client.js'
import { camera, site } from '../db/schema.js'
import { config } from './config.js'
import { settingNumber } from './settings.js'

const TICK_MS = 60_000

/**
 * Publishes into the regular `events` stream so the standard pipeline
 * (persist → WS fan-out → alert rules with cooldown/quiet hours) applies.
 */
async function publish(redis: Redis, msg: Record<string, unknown>): Promise<void> {
  await redis.xadd(config.EVENTS_STREAM, '*', 'data', JSON.stringify(msg))
}

/**
 * Camera offline watchdog. The analyzer heartbeats `camera_alive:{id}`
 * (TTL 15s); this check turns a sustained heartbeat loss into a
 * `camera_offline` event (and `camera_online` on recovery).
 *
 * Redis state per camera:
 * - `camera_last_seen:{id}` — ms timestamp of the last observed heartbeat.
 *   Absent until the camera has been alive at least once, so freshly added
 *   cameras (or a not-yet-deployed analyzer) never alarm.
 * - `camera_down:{id}` — set (NX, so concurrent API instances emit once)
 *   when the outage event is published; cleared on recovery.
 */
export async function checkCameras(redis: Redis, log?: FastifyBaseLogger): Promise<void> {
  // `file` cameras are looped test videos — not worth an outage page
  const cams = await db.select({
    id: camera.id, siteId: camera.siteId, tenantId: site.tenantId,
  }).from(camera).innerJoin(site, eq(camera.siteId, site.id))
    .where(ne(camera.sourceType, 'file'))
  if (cams.length === 0) return

  const ids = cams.map((c) => c.id)
  const [alive, lastSeen, down] = await Promise.all([
    redis.mget(ids.map((id) => `camera_alive:${id}`)),
    redis.mget(ids.map((id) => `camera_last_seen:${id}`)),
    redis.mget(ids.map((id) => `camera_down:${id}`)),
  ])
  const now = Date.now()
  const thresholdMs = (await settingNumber('camera_offline_alert_seconds')) * 1000

  for (let i = 0; i < cams.length; i++) {
    const c = cams[i]!
    const base = {
      tenant_id: c.tenantId, site_id: c.siteId, camera_id: c.id,
      ts_start: new Date(now).toISOString(),
    }

    if (alive[i]) {
      await redis.set(`camera_last_seen:${c.id}`, String(now))
      if (down[i]) {
        await redis.del(`camera_down:${c.id}`)
        await publish(redis, {
          ...base, type: 'camera_online', severity: 'info',
          meta: { offline_since: down[i] },
        })
        log?.info?.({ camera: c.id }, 'watchdog: camera back online')
      }
      continue
    }

    if (down[i]) continue // outage already reported
    const seen = lastSeen[i] ? Number(lastSeen[i]) : null
    if (seen === null || now - seen < thresholdMs) continue

    const lastSeenIso = new Date(seen).toISOString()
    const ok = await redis.set(`camera_down:${c.id}`, lastSeenIso, 'NX')
    if (ok !== 'OK') continue
    await publish(redis, {
      ...base, type: 'camera_offline', severity: 'critical',
      meta: { last_seen_at: lastSeenIso },
    })
    log?.warn?.({ camera: c.id, last_seen_at: lastSeenIso }, 'watchdog: camera offline')
  }
}

/** Startup + periodic camera heartbeat check. Returns a stop fn. */
export function startCameraWatchdog(redis: Redis, log?: FastifyBaseLogger): () => void {
  const run = (): void => {
    void checkCameras(redis, log).catch((err: unknown) => {
      log?.error?.({ err }, 'camera watchdog tick failed')
    })
  }
  run()
  const timer = setInterval(run, TICK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
