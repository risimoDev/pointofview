import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { alertRule, camera, event, notification, site, zone } from '../../db/schema.js'
import { config } from '../config.js'
import { ALERTS_QUEUE, type AlertJob } from '../queues.js'
import { minio } from '../minio.js'

const log = (msg: string, extra?: unknown): void => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, extra }))
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴', warn: '🟡', info: 'ℹ️',
}

// channels jsonb shape (only telegram dispatched; others recorded unsupported)
const TelegramChannel = z.object({ type: z.literal('telegram'), chat_id: z.union([z.string(), z.number()]) })
const Channel = z.union([TelegramChannel, z.object({ type: z.string() }).passthrough()])
const Channels = z.array(Channel)

interface EventCtx {
  type: string
  severity: string
  tsStart: Date
  cameraId: string
  snapshotKey: string | null
  cameraName: string
  tz: string
  zoneName: string | null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildText(ctx: EventCtx): string {
  const emoji = SEVERITY_EMOJI[ctx.severity] ?? 'ℹ️'
  const tsLocal = new Intl.DateTimeFormat('ru-RU', {
    timeZone: ctx.tz, dateStyle: 'short', timeStyle: 'medium',
  }).format(ctx.tsStart)
  const lines = [
    `${emoji} <b>${escapeHtml(ctx.type)}</b>`,
    `📹 ${escapeHtml(ctx.cameraName)}`,
    ctx.zoneName ? `📍 ${escapeHtml(ctx.zoneName)}` : null,
    `🕐 ${tsLocal}`,
  ].filter((l): l is string => l !== null)
  return lines.join('\n')
}

const tgBase = (): string => `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`

async function tgJson(method: string, body: unknown): Promise<void> {
  const res = await fetch(`${tgBase()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`)
}

async function sendTelegram(chatId: string | number, ctx: EventCtx): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured')
  const text = buildText(ctx)
  await tgJson('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' })

  if (ctx.snapshotKey) {
    const url = await minio.presignedGetObject(config.MINIO_BUCKET_SNAPSHOTS, ctx.snapshotKey, 300)
    const img = await fetch(url)
    if (!img.ok) return // message already sent; skip photo on fetch failure
    const bytes = Buffer.from(await img.arrayBuffer())
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'snapshot.jpg')
    const res = await fetch(`${tgBase()}/sendPhoto`, { method: 'POST', body: form })
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (!data.ok) throw new Error(`telegram sendPhoto: ${data.description ?? res.status}`)
  }
}

async function processAlert(job: Job<AlertJob>, redis: IORedis): Promise<void> {
  const { event_id, tenant_id } = job.data

  const [ctx] = await db.select({
    type: event.type, severity: event.severity, tsStart: event.tsStart,
    cameraId: event.cameraId, snapshotKey: event.snapshotKey,
    cameraName: camera.name, tz: site.timezone, zoneName: zone.name,
  }).from(event)
    .innerJoin(camera, eq(event.cameraId, camera.id))
    .innerJoin(site, eq(event.siteId, site.id))
    .leftJoin(zone, eq(event.zoneId, zone.id))
    .where(and(eq(event.id, event_id), eq(event.tenantId, tenant_id)))
    .limit(1)
  if (!ctx) { log('alert: event not found', { event_id }); return }

  const rules = await db.select().from(alertRule).where(and(
    eq(alertRule.tenantId, tenant_id),
    eq(alertRule.eventType, ctx.type),
    eq(alertRule.enabled, true),
  ))

  for (const rule of rules) {
    // cooldown per (rule, camera) via atomic SET NX EX
    const key = `cooldown:${rule.id}:${ctx.cameraId}`
    const ok = await redis.set(key, '1', 'EX', Math.max(1, rule.cooldownSeconds), 'NX')
    if (ok !== 'OK') continue

    const channels = Channels.safeParse(rule.channels)
    if (!channels.success) {
      log('alert: invalid channels', { ruleId: rule.id })
      continue
    }

    for (const ch of channels.data) {
      let status: 'sent' | 'failed' = 'sent'
      let error: string | null = null
      try {
        if (ch.type === 'telegram') {
          await sendTelegram((ch as z.infer<typeof TelegramChannel>).chat_id, ctx)
        } else {
          throw new Error(`unsupported channel: ${ch.type}`)
        }
      } catch (err) {
        status = 'failed'
        error = err instanceof Error ? err.message : String(err)
        log('alert dispatch failed', { ruleId: rule.id, channel: ch.type, error })
      }
      await db.insert(notification).values({
        eventId: event_id,
        ruleId: rule.id,
        channel: ch.type.slice(0, 32),
        status,
        error,
        sentAt: status === 'sent' ? new Date() : null,
      })
    }
  }
}

async function main(): Promise<void> {
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const cmd = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const worker = new Worker<AlertJob>(ALERTS_QUEUE, (job) => processAlert(job, cmd), {
    connection: connection as ConnectionOptions, concurrency: 5,
  })

  worker.on('failed', (job, err) => log('alert job failed', { id: job?.id, err: err.message }))

  const shutdown = async (): Promise<void> => {
    await worker.close()
    await Promise.allSettled([connection.quit(), cmd.quit()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  log('alerts worker started')
}

void main()
