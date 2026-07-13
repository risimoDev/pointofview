import { statfs, unlink } from 'node:fs/promises'
import type { FastifyBaseLogger } from 'fastify'
import { asc, inArray, lt, sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { archiveSegment } from '../db/schema.js'
import { config } from './config.js'
import { settingNumber } from './settings.js'

const TICK_MS = 3_600_000 // hourly
const BATCH = 500

async function freeGb(path: string): Promise<number | null> {
  try {
    const s = await statfs(path)
    return (s.bavail * s.bsize) / 1024 ** 3
  } catch {
    return null // archive dir not mounted in this environment
  }
}

type Segment = { id: string; filePath: string }

async function deleteSegments(segs: Segment[], log?: FastifyBaseLogger): Promise<void> {
  if (segs.length === 0) return
  for (const s of segs) {
    try {
      await unlink(s.filePath)
    } catch (err: unknown) {
      // file already gone is fine; anything else — log but still drop the row,
      // otherwise one bad file would wedge retention forever
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') log?.warn?.({ file: s.filePath, code }, 'retention: unlink failed')
    }
  }
  await db.delete(archiveSegment).where(inArray(archiveSegment.id, segs.map((s) => s.id)))
}

export async function runRetention(log?: FastifyBaseLogger): Promise<void> {
  // 1. events: drop whole hypertable chunks past the retention window.
  // drop_chunks is the TimescaleDB-native way — instant, frees disk, no bloat.
  const eventDays = await settingNumber('event_retention_days')
  await db.execute(sql`
    SELECT drop_chunks('event', older_than => ${eventDays}::int * INTERVAL '1 day')
  `)

  // 2. archive: segments older than the retention window
  const days = await settingNumber('archive_retention_days')
  const cutoff = new Date(Date.now() - days * 86_400_000)
  for (;;) {
    const old = await db.select({ id: archiveSegment.id, filePath: archiveSegment.filePath })
      .from(archiveSegment).where(lt(archiveSegment.startedAt, cutoff))
      .orderBy(asc(archiveSegment.startedAt)).limit(BATCH)
    if (old.length === 0) break
    await deleteSegments(old, log)
    log?.info?.({ deleted: old.length, olderThanDays: days }, 'retention: archive segments removed')
    if (old.length < BATCH) break
  }

  // 3. free-space floor: emergency-delete oldest segments regardless of age
  const minFree = await settingNumber('archive_min_free_gb')
  for (let guard = 0; guard < 40; guard++) {
    const free = await freeGb(config.ARCHIVE_ROOT)
    if (free === null || free >= minFree) break
    const oldest = await db.select({ id: archiveSegment.id, filePath: archiveSegment.filePath })
      .from(archiveSegment).orderBy(asc(archiveSegment.startedAt)).limit(200)
    if (oldest.length === 0) break
    await deleteSegments(oldest, log)
    log?.warn?.(
      { deleted: oldest.length, freeGb: Math.round(free * 10) / 10, minFreeGb: minFree },
      'retention: low disk space, oldest segments removed',
    )
  }
}

/** Startup + hourly retention pass. Returns a stop fn. */
export function startRetention(log?: FastifyBaseLogger): () => void {
  const run = (): void => {
    void runRetention(log).catch((err: unknown) => {
      log?.error?.({ err }, 'retention pass failed')
    })
  }
  run()
  const timer = setInterval(run, TICK_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
