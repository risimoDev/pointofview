import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import IORedis from 'ioredis'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { event } from '../../db/schema.js'
import { config } from '../config.js'
import { minio } from '../minio.js'
import { AI_QUEUE, aiQueue, alertsQueue, type AiJob } from '../queues.js'
import { typeLabel } from '../event_labels.js'
import {
  VLM_WORKER_ALIVE_KEY, bumpVlmStat, fpKey, ollamaVision, parseVerdict, snapshotB64,
  vlmSettings,
} from '../vlm.js'

// Pre-alert enrichment stage (consumer → ai → alerts):
//  1. capture the camera frame from go2rtc → MinIO → event.snapshot_key
//     (runs for every alertable event — this is what puts snapshots on events
//     and photos into Telegram);
//  2. `vlm` feature on: a local Ollama VLM writes a short RU scene description
//     into event.meta.ai_description;
//  3. verification gate: for event types a frame can confirm, when the
//     operator has marked enough false positives on this camera+type (or
//     verify is forced in the feature config), the VLM is asked ДА/НЕТ —
//     a НЕТ suppresses the alert (the event stays in the journal with
//     meta.ai_verified=false). Fail-open: any VLM error → alert goes out.

const SNAPSHOT_TIMEOUT_MS = 5_000
// A frame older than this no longer shows the event: verification would judge
// an empty scene, so it is skipped (alert goes out) instead of suppressing.
const MAX_VERIFY_AGE_SEC = 45
// When the queue is this deep the VLM (~10 s per call) can never catch up;
// enrichment degrades to snapshots only until the backlog drains.
const BACKLOG_SKIP_VLM = 30

// Types a SINGLE FRAME genuinely shows. A frame can prove a missing helmet, a
// person on the floor, a crowd. It CANNOT prove the geometric/temporal events:
// the model doesn't see the (invisible) zone polygon, can't know someone waited
// too long, and can't know who counts as staff — so for zone_violation /
// queue_alert / unknown_person / lone_worker it kept answering НЕТ and threw
// real alerts away (623 suppressed vs 2 confirmed). Those are trusted as-is;
// only visually self-evident events go through the VLM gate.
// Infrastructure events (camera_offline/tampered) are never suppressed.
const VERIFIABLE_TYPES = new Set([
  'ppe_violation', 'fall_detected', 'crowd',
])

const SEVERITY_RANK: Record<string, number> = { info: 0, warn: 1, critical: 2 }

const log = (msg: string, extra?: Record<string, unknown>): void => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }))
}

/** go2rtc current frame → MinIO; returns the object key or null. */
async function captureSnapshot(
  tenantId: string, eventId: string, cameraId: string,
): Promise<string | null> {
  try {
    const url = `${config.GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(cameraId)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1_000) return null // go2rtc error page / empty frame
    const key = `events/${tenantId}/${eventId}.jpg`
    await minio.putObject(config.MINIO_BUCKET_SNAPSHOTS, key, buf, buf.length, {
      'Content-Type': 'image/jpeg',
    })
    return key
  } catch {
    return null // camera offline / go2rtc restarting — alert goes out without a photo
  }
}

async function mergeMeta(
  eventId: string, tenantId: string, patch: Record<string, unknown>,
): Promise<void> {
  await db.update(event)
    .set({ meta: sql`${event.meta} || ${JSON.stringify(patch)}::jsonb` })
    .where(and(eq(event.id, eventId), eq(event.tenantId, tenantId)))
}

async function processJob(job: Job<AiJob>, redis: IORedis): Promise<void> {
  const { event_id, tenant_id } = job.data
  const [ev] = await db.select({
    id: event.id, cameraId: event.cameraId, severity: event.severity,
    type: event.type, snapshotKey: event.snapshotKey, tsStart: event.tsStart,
  }).from(event)
    .where(and(eq(event.id, event_id), eq(event.tenantId, tenant_id)))
    .limit(1)

  let suppress = false
  await bumpVlmStat(redis, tenant_id, 'jobs')
  if (ev) {
    let snapshotKey = ev.snapshotKey
    if (!snapshotKey) {
      snapshotKey = await captureSnapshot(tenant_id, event_id, ev.cameraId)
      if (snapshotKey) {
        await db.update(event).set({ snapshotKey })
          .where(and(eq(event.id, event_id), eq(event.tenantId, tenant_id)))
      }
    }

    try {
      const vlm = await vlmSettings(tenant_id)
      const backlog = await aiQueue.getWaitingCount()
      if (backlog > BACKLOG_SKIP_VLM) {
        await bumpVlmStat(redis, tenant_id, 'skipped')
        log('vlm skipped: queue backlog', { backlog })
      } else if (vlm.enabled && snapshotKey) {
        const image = await snapshotB64(snapshotKey)
        const label = typeLabel(ev.type)

        if ((SEVERITY_RANK[ev.severity] ?? 0) >= SEVERITY_RANK[vlm.minSeverity]!) {
          const description = await ollamaVision(vlm.model, image,
            'Ты помощник оператора видеонаблюдения. Событие: '
            + `«${label}». Опиши одним-двумя короткими предложениями, что видно `
            + 'на кадре и относится к событию: сколько людей, что делают, есть '
            + 'ли признаки опасности. Пиши по-русски, только факты, без вступлений.')
          if (description) {
            await mergeMeta(event_id, tenant_id, {
              ai_description: description.slice(0, 500), ai_model: vlm.model,
            })
            await bumpVlmStat(redis, tenant_id, 'described')
          }
        }

        // verification gate: only after operator feedback (or forced), only
        // for frame-verifiable types, and only while the frame still shows the
        // moment. The snapshot is a LIVE go2rtc frame grabbed here, so a queue
        // backlog means an empty scene — and the model honestly answers НЕТ.
        // Suppressing on that evidence throws real alerts away (623 НЕТ vs 2 ДА).
        const ageSec = (Date.now() - ev.tsStart.getTime()) / 1000
        const fresh = ageSec <= MAX_VERIFY_AGE_SEC
        if (VERIFIABLE_TYPES.has(ev.type) && !fresh) {
          await mergeMeta(event_id, tenant_id, { ai_verify_skipped: 'stale_frame' })
          await bumpVlmStat(redis, tenant_id, 'stale')
        }
        if (VERIFIABLE_TYPES.has(ev.type) && fresh) {
          const fpCount = Math.max(0, Number(
            await redis.get(fpKey(tenant_id, ev.cameraId, ev.type)) ?? 0,
          ))
          if (vlm.verify || fpCount >= vlm.autoVerifyAfter) {
            const verdict = await ollamaVision(vlm.model, image,
              `Событие видеонаблюдения: «${label}». Посмотри на кадр и ответь, `
              + 'действительно ли событие подтверждается изображением. Первым '
              + 'словом напиши строго ДА или НЕТ, затем одну короткую фразу почему.')
            // the verdict word may come after a lead-in ("На кадре… Нет,…"),
            // so it's searched for, not required at position 0
            const confirmed = parseVerdict(verdict)
            if (confirmed === false) {
              suppress = true
              await mergeMeta(event_id, tenant_id, {
                ai_verified: false, ai_verdict: verdict?.slice(0, 300) ?? '',
              })
              await bumpVlmStat(redis, tenant_id, 'suppressed')
              log('alert suppressed by vlm', { event_id, type: ev.type })
            } else if (confirmed === true) {
              await mergeMeta(event_id, tenant_id, { ai_verified: true })
              await bumpVlmStat(redis, tenant_id, 'verified')
            }
            // unparseable answer → fail-open, alert goes out
          }
        }
      }
    } catch (err) {
      // VLM is best-effort: model not pulled / Ollama down / timeout.
      // The reason is stored so /admin/features can show it — silent
      // fail-open is exactly why «VLM не работает» went unnoticed.
      const reason = err instanceof Error ? err.message : String(err)
      await bumpVlmStat(redis, tenant_id, 'failed', reason)
      log('vlm step failed', { event_id, err: reason })
    }
  }

  if (!suppress) {
    await alertsQueue.add('notify', { event_id, tenant_id }, {
      removeOnComplete: 200, removeOnFail: 500, attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
    })
  }
}

async function main(): Promise<void> {
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const cmd = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const worker = new Worker<AiJob>(AI_QUEUE, (job) => processJob(job, cmd), {
    connection: connection as ConnectionOptions,
    concurrency: 2, // snapshots parallelize fine; Ollama serializes internally
  })
  worker.on('failed', (job, err) => {
    log('ai job failed', { id: job?.id, err: err.message })
    // enrichment must never lose the alert: forward on final failure
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void alertsQueue.add('notify', job.data, {
        removeOnComplete: 200, removeOnFail: 500, attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      })
    }
  })

  // heartbeat: absence of this key on /admin/features means the container
  // itself is down (as opposed to Ollama or the model being missing)
  const beat = async (): Promise<void> => {
    try {
      await cmd.set(VLM_WORKER_ALIVE_KEY, String(Date.now()), 'EX', 90)
    } catch { /* redis flap — next tick */ }
  }
  await beat()
  const heartbeat = setInterval(() => void beat(), 30_000)

  const shutdown = async (): Promise<void> => {
    clearInterval(heartbeat)
    await worker.close()
    await Promise.allSettled([connection.quit(), cmd.quit()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  log('ai worker started', { ollama: config.OLLAMA_URL, model: config.VLM_MODEL })
}

void main()
