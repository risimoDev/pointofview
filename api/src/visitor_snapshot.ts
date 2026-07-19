import type Redis from 'ioredis'
import { sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { tenant, visitorDaily } from '../db/schema.js'

// The counter plugin keeps today's per-site visitor count in Redis
// (visitors:{tenant} hash, reset daily). This ticker snapshots it into
// visitor_daily so analytics gets a history the day the counter forgets.

const TICK_MS = 10 * 60_000

interface VisitorsJson {
  visitors?: number
  day?: string
}

async function snapshot(redis: Redis): Promise<void> {
  const tenants = await db.select({ id: tenant.id }).from(tenant)
  for (const t of tenants) {
    const raw = await redis.hgetall(`visitors:${t.id}`)
    for (const [siteId, json] of Object.entries(raw)) {
      let v: VisitorsJson
      try {
        v = JSON.parse(json) as VisitorsJson
      } catch {
        continue
      }
      if (!v.day || typeof v.visitors !== 'number') continue
      await db.insert(visitorDaily)
        .values({ siteId, day: v.day, visitors: v.visitors })
        .onConflictDoUpdate({
          target: [visitorDaily.siteId, visitorDaily.day],
          // greatest(): the day counter only grows; never shrink a snapshot
          // because Redis restarted mid-day
          set: {
            visitors: sql`greatest(${visitorDaily.visitors}, ${v.visitors})`,
            updatedAt: new Date(),
          },
        })
        .catch(() => undefined) // site may have been deleted between reads
    }
  }
}

/** Periodic Redis → PostgreSQL visitor snapshot. Returns a stop fn. */
export function startVisitorSnapshot(
  redis: Redis,
  log?: { error?: (o: unknown, m: string) => void },
): () => void {
  const tick = (): void => {
    snapshot(redis).catch((err) => log?.error?.(err, 'visitor snapshot failed'))
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
