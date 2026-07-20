import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import IORedis from 'ioredis'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { event, tenantFeature } from '../../db/schema.js'
import { config } from '../config.js'
import { minio } from '../minio.js'
import { AI_QUEUE, alertsQueue, type AiJob } from '../queues.js'
import { typeLabel } from '../event_labels.js'

// Pre-alert enrichment stage (consumer → ai → alerts):
//  1. capture the camera frame from go2rtc → MinIO → event.snapshot_key
//     (runs for every alertable event — this is what puts snapshots on events
//     and photos into Telegram);
//  2. when the `vlm` feature is on: a local Ollama VLM writes a short RU
//     scene description into event.meta.ai_description (the alert text and
//     the events UI pick it up).
// Both steps are best-effort with timeouts: the alert must go out even when
// go2rtc or Ollama are down. Worst-case added latency ≈ VLM_TIMEOUT.

const SNAPSHOT_TIMEOUT_MS = 5_000
const VLM_TIMEOUT_MS = 40_000

const log = (msg: string, extra?: Record<string, unknown>): void => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }))
}

interface VlmConfig {
  enabled: boolean
  model: string
  minSeverity: 'info' | 'warn' | 'critical'
}

async function vlmConfig(tenantId: string): Promise<VlmConfig> {
  const [row] = await db.select({
    enabled: tenantFeature.enabled, config: tenantFeature.config,
  }).from(tenantFeature)
    .where(and(eq(tenantFeature.tenantId, tenantId), eq(tenantFeature.feature, 'vlm')))
    .limit(1)
  const cfg = (row?.config ?? {}) as { model?: unknown; min_severity?: unknown }
  const sev = cfg.min_severity
  return {
    enabled: Boolean(row?.enabled),
    model: typeof cfg.model === 'string' && cfg.model ? cfg.model : config.VLM_MODEL,
    minSeverity: sev === 'info' || sev === 'warn' || sev === 'critical' ? sev : 'warn',
  }
}

const SEVERITY_RANK: Record<string, number> = { info: 0, warn: 1, critical: 2 }

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

async function describeFrame(
  model: string, snapshotKey: string, eventType: string,
): Promise<string | null> {
  const stream = await minio.getObject(config.MINIO_BUCKET_SNAPSHOTS, snapshotKey)
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const image = Buffer.concat(chunks).toString('base64')

  const prompt =
    'Ты помощник оператора видеонаблюдения. Событие: '
    + `«${typeLabel(eventType)}». Опиши одним-двумя короткими предложениями, `
    + 'что видно на кадре и относится к событию: сколько людей, что делают, '
    + 'есть ли признаки опасности. Пиши по-русски, только факты, без вступлений.'

  const res = await fetch(`${config.OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      images: [image],
      stream: false,
      options: { temperature: 0.2, num_predict: 120 },
    }),
    signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`ollama: HTTP ${res.status}`)
  const data = (await res.json()) as { response?: string }
  const text = (data.response ?? '').trim().replace(/\s+/g, ' ')
  return text ? text.slice(0, 500) : null
}

async function processJob(job: Job<AiJob>): Promise<void> {
  const { event_id, tenant_id } = job.data
  const [ev] = await db.select({
    id: event.id, cameraId: event.cameraId, severity: event.severity,
    type: event.type, snapshotKey: event.snapshotKey, tsStart: event.tsStart,
  }).from(event)
    .where(and(eq(event.id, event_id), eq(event.tenantId, tenant_id)))
    .limit(1)

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
      const vlm = await vlmConfig(tenant_id)
      if (vlm.enabled && snapshotKey
          && (SEVERITY_RANK[ev.severity] ?? 0) >= SEVERITY_RANK[vlm.minSeverity]!) {
        const description = await describeFrame(vlm.model, snapshotKey, ev.type)
        if (description) {
          await db.update(event)
            .set({
              meta: sql`${event.meta} || ${JSON.stringify({
                ai_description: description, ai_model: vlm.model,
              })}::jsonb`,
            })
            .where(and(eq(event.id, event_id), eq(event.tenantId, tenant_id)))
          log('described', { event_id, model: vlm.model })
        }
      }
    } catch (err) {
      // VLM is best-effort: model not pulled / Ollama down / timeout
      log('vlm describe failed', { event_id, err: err instanceof Error ? err.message : String(err) })
    }
  }

  await alertsQueue.add('notify', { event_id, tenant_id }, {
    removeOnComplete: 200, removeOnFail: 500, attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  })
}

async function main(): Promise<void> {
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const worker = new Worker<AiJob>(AI_QUEUE, processJob, {
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

  const shutdown = async (): Promise<void> => {
    await worker.close()
    await connection.quit()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  log('ai worker started', { ollama: config.OLLAMA_URL, model: config.VLM_MODEL })
}

void main()
