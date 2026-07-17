import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { alertRule, camera, event, notification, site, zone } from '../../db/schema.js'
import { config } from '../config.js'
import { ALERTS_QUEUE, alertsQueue, type AlertJob } from '../queues.js'
import { minio } from '../minio.js'
import { settingNumber, settingSecret } from '../settings.js'

const log = (msg: string, extra?: unknown): void => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, extra }))
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴', warn: '🟡', info: 'ℹ️',
}

// human-readable RU event names for outgoing notifications
const TYPE_LABELS: Record<string, string> = {
  zone_entry: 'Вход в зону', zone_exit: 'Выход из зоны',
  zone_violation: 'Нарушение зоны', queue_alert: 'Очередь',
  ppe_violation: 'Нарушение СИЗ', repack_event: 'Перепаковка',
  shelf_violation: 'Нарушение выкладки', crowd: 'Скопление людей',
  unknown_person: 'Неизвестный человек',
  camera_offline: 'Камера не в сети', camera_online: 'Камера снова в сети',
  fall_detected: 'Падение человека',
}

const SEVERITY_RANK: Record<string, number> = { info: 0, warn: 1, critical: 2 }

// channels jsonb shape (telegram + webhook dispatched; others recorded unsupported)
const TelegramChannel = z.object({ type: z.literal('telegram'), chat_id: z.union([z.string(), z.number()]) })
const WebhookChannel = z.object({ type: z.literal('webhook'), url: z.string().url() })
const Channel = z.union([TelegramChannel, WebhookChannel, z.object({ type: z.string() }).passthrough()])
const Channels = z.array(Channel)

/** True when local time (site tz) is inside the [quiet_from, quiet_to) window.
 *  Window may wrap past midnight (e.g. 22:00 → 08:00). */
function inQuietHours(schedule: Record<string, unknown>, tz: string, now: Date): boolean {
  const from = typeof schedule.quiet_from === 'string' ? schedule.quiet_from : null
  const to = typeof schedule.quiet_to === 'string' ? schedule.quiet_to : null
  if (!from || !to || from === to) return false
  const hhmm = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
  return from < to
    ? hhmm >= from && hhmm < to
    : hhmm >= from || hhmm < to // wraps midnight
}

interface EventCtx {
  type: string
  severity: string
  tsStart: Date
  cameraId: string
  snapshotKey: string | null
  cameraName: string
  tz: string
  zoneName: string | null
  meta?: Record<string, unknown>
}

// digest buffer entry (Redis list digest:{rule_id})
interface DigestEntry {
  type: string
  zone: string | null
  camera: string
  gid: string | null
  tz: string
  ts: string
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
    `${emoji} <b>${escapeHtml(TYPE_LABELS[ctx.type] ?? ctx.type)}</b>`,
    `📹 ${escapeHtml(ctx.cameraName)}`,
    ctx.zoneName ? `📍 ${escapeHtml(ctx.zoneName)}` : null,
    `🕐 ${tsLocal}`,
  ].filter((l): l is string => l !== null)
  return lines.join('\n')
}

async function sendWebhook(url: string, ctx: EventCtx): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: ctx.type,
      type_label: TYPE_LABELS[ctx.type] ?? ctx.type,
      severity: ctx.severity,
      camera: ctx.cameraName,
      zone: ctx.zoneName,
      ts: ctx.tsStart.toISOString(),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`webhook ${url}: HTTP ${res.status}`)
}

// token from /admin/settings wins; env is the fallback
const tgToken = async (): Promise<string> =>
  (await settingSecret('telegram_bot_token')) || config.TELEGRAM_BOT_TOKEN

async function tgJson(token: string, method: string, body: unknown): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok: boolean; description?: string }
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`)
}

async function sendTelegram(chatId: string | number, ctx: EventCtx): Promise<void> {
  const token = await tgToken()
  if (!token) throw new Error('telegram bot token not configured (settings/env)')
  const text = buildText(ctx)
  await tgJson(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' })

  if (ctx.snapshotKey) {
    const url = await minio.presignedGetObject(config.MINIO_BUCKET_SNAPSHOTS, ctx.snapshotKey, 300)
    const img = await fetch(url)
    if (!img.ok) return // message already sent; skip photo on fetch failure
    const bytes = Buffer.from(await img.arrayBuffer())
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'snapshot.jpg')
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (!data.ok) throw new Error(`telegram sendPhoto: ${data.description ?? res.status}`)
  }
}

// «Отправить тестовое» from the admin page: synthetic message straight to the
// rule's channels — no event, no cooldown, no quiet hours (that's the point).
async function processTest(ruleId: string, tenantId: string): Promise<void> {
  const [rule] = await db.select().from(alertRule)
    .where(and(eq(alertRule.id, ruleId), eq(alertRule.tenantId, tenantId))).limit(1)
  if (!rule) { log('test: rule not found', { ruleId }); return }
  const channels = Channels.safeParse(rule.channels)
  if (!channels.success) { log('test: invalid channels', { ruleId }); return }

  const ctx: EventCtx = {
    type: rule.eventType, severity: 'info', tsStart: new Date(),
    cameraId: '', snapshotKey: null, cameraName: 'Тестовое уведомление',
    tz: 'Europe/Moscow', zoneName: null,
  }
  for (const ch of channels.data) {
    if (ch.type === 'telegram') {
      await sendTelegram((ch as z.infer<typeof TelegramChannel>).chat_id, ctx)
    } else if (ch.type === 'webhook') {
      await sendWebhook((ch as z.infer<typeof WebhookChannel>).url, ctx)
    }
  }
}

/** Periodic flush: one summary message per rule instead of an event stream.
 *  A rule flushes when its buffer is older than `alert_digest_minutes`. */
async function processDigest(redis: IORedis): Promise<void> {
  const minutes = await settingNumber('alert_digest_minutes')
  const ruleIds = await redis.smembers('digest:rules')
  for (const ruleId of ruleIds) {
    const lastRaw = await redis.get(`digest:last:${ruleId}`)
    if (lastRaw && Date.now() - Number(lastRaw) < minutes * 60_000) continue

    const rawEntries = await redis.lrange(`digest:${ruleId}`, 0, -1)
    if (rawEntries.length === 0) {
      await redis.srem('digest:rules', ruleId)
      continue
    }
    const [rule] = await db.select().from(alertRule).where(eq(alertRule.id, ruleId)).limit(1)
    if (!rule || !rule.enabled) {
      await redis.del(`digest:${ruleId}`)
      await redis.srem('digest:rules', ruleId)
      continue
    }

    const entries: DigestEntry[] = []
    for (const raw of rawEntries) {
      try { entries.push(JSON.parse(raw) as DigestEntry) } catch { /* skip */ }
    }
    const tz = entries[0]?.tz ?? 'Europe/Moscow'
    // hold the digest through quiet hours; it goes out in the morning
    if (inQuietHours(rule.schedule, tz, new Date())) continue

    await redis.del(`digest:${ruleId}`)
    await redis.set(`digest:last:${ruleId}`, String(Date.now()))

    // group by type+zone, count events and distinct people
    const groups = new Map<string, { count: number; people: Set<string> }>()
    for (const e of entries) {
      const label = `${TYPE_LABELS[e.type] ?? e.type}${e.zone ? ` — ${e.zone}` : ''}`
      const g = groups.get(label) ?? { count: 0, people: new Set<string>() }
      g.count++
      if (e.gid) g.people.add(e.gid)
      groups.set(label, g)
    }
    const lines = [`📊 <b>Сводка за ${minutes} мин</b>`]
    for (const [label, g] of groups) {
      const people = g.people.size > 0 ? `, людей: ${g.people.size}` : ''
      lines.push(`• ${escapeHtml(label)}: ${g.count}${people}`)
    }
    const text = lines.join('\n')

    const channels = Channels.safeParse(rule.channels)
    if (!channels.success) continue
    for (const ch of channels.data) {
      try {
        if (ch.type === 'telegram') {
          const token = await tgToken()
          if (!token) throw new Error('telegram bot token not configured')
          await tgJson(token, 'sendMessage', {
            chat_id: (ch as z.infer<typeof TelegramChannel>).chat_id,
            text, parse_mode: 'HTML',
          })
        } else if (ch.type === 'webhook') {
          const res = await fetch((ch as z.infer<typeof WebhookChannel>).url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ digest: true, minutes, entries }),
            signal: AbortSignal.timeout(10_000),
          })
          if (!res.ok) throw new Error(`webhook HTTP ${res.status}`)
        }
      } catch (err) {
        log('digest dispatch failed', {
          ruleId, channel: ch.type,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    log('digest sent', { ruleId, events: entries.length })
  }
}

async function processAlert(job: Job<AlertJob>, redis: IORedis): Promise<void> {
  const { event_id, tenant_id, test_rule_id, digest } = job.data
  if (digest) { await processDigest(redis); return }
  if (test_rule_id) { await processTest(test_rule_id, tenant_id); return }

  const [ctx] = await db.select({
    type: event.type, severity: event.severity, tsStart: event.tsStart,
    cameraId: event.cameraId, snapshotKey: event.snapshotKey,
    cameraName: camera.name, tz: site.timezone, zoneName: zone.name,
    meta: event.meta,
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

  // cross-camera person identity: the same visitor on 4 cameras is ONE subject
  const gid = typeof ctx.meta?.global_id === 'string' ? ctx.meta.global_id : null

  for (const rule of rules) {
    // conditions.min_severity: skip events below the rule's threshold
    const minSev = typeof rule.conditions.min_severity === 'string'
      ? rule.conditions.min_severity : 'info'
    if ((SEVERITY_RANK[ctx.severity] ?? 0) < (SEVERITY_RANK[minSev] ?? 0)) continue

    // schedule.quiet_from/quiet_to: silence the rule during quiet hours (site tz)
    if (inQuietHours(rule.schedule, ctx.tz, ctx.tsStart)) continue

    // cooldown per (rule, person) — camera is only the fallback subject,
    // so a person flickering between cameras can't re-trigger the rule
    const key = `cooldown:${rule.id}:${gid ?? ctx.cameraId}`
    const ok = await redis.set(key, '1', 'EX', Math.max(1, rule.cooldownSeconds), 'NX')
    if (ok !== 'OK') continue

    // non-critical events accumulate into a periodic digest instead of
    // spamming a message each — critical ones still go out instantly
    if (ctx.severity !== 'critical') {
      const entry: DigestEntry = {
        type: ctx.type, zone: ctx.zoneName, camera: ctx.cameraName,
        gid, tz: ctx.tz, ts: ctx.tsStart.toISOString(),
      }
      await redis.rpush(`digest:${rule.id}`, JSON.stringify(entry))
      await redis.sadd('digest:rules', rule.id)
      continue
    }

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
        } else if (ch.type === 'webhook') {
          await sendWebhook((ch as z.infer<typeof WebhookChannel>).url, ctx)
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

  // digest tick: every minute check which rule buffers are due to flush
  await alertsQueue.add('digest', { event_id: '', tenant_id: '', digest: true }, {
    repeat: { every: 60_000 }, jobId: 'digest-tick',
    removeOnComplete: 5, removeOnFail: 5,
  })

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
