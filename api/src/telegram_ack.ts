import type IORedis from 'ioredis'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db/client.js'
import { alertRule, event } from '../db/schema.js'
import { markFalsePositive, resolveEvent } from './event_actions.js'
import { TYPE_LABELS } from './event_labels.js'

/** Acknowledging an alert from the Telegram message itself.
 *
 *  Long polling, not a webhook, on purpose: an on-premise install sits in an
 *  isolated network where Telegram cannot open an inbound connection, and a
 *  webhook would also need a public route, a TLS name and nginx work on the
 *  VPS. Polling needs none of that and behaves identically in both deployment
 *  modes. Cost: one idle HTTP request per 30 s.
 *
 *  Only ONE poller may call getUpdates for a bot — a second one makes Telegram
 *  answer 409 to both. A Redis lock keeps that true even if the worker is
 *  scaled to several replicas.
 */

const LOCK_KEY = 'tg:ack:lock'
const OFFSET_KEY = 'tg:ack:offset'
const LOCK_TTL_SEC = 60
const POLL_TIMEOUT_SEC = 30

const CallbackQuery = z.object({
  id: z.string(),
  data: z.string().optional(),
  from: z.object({
    id: z.number(),
    first_name: z.string().optional(),
    username: z.string().optional(),
  }),
  message: z.object({
    message_id: z.number(),
    chat: z.object({ id: z.union([z.number(), z.string()]) }),
  }).optional(),
})
const Update = z.object({
  update_id: z.number(),
  callback_query: CallbackQuery.optional(),
})
const GetUpdates = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z.array(Update).optional(),
})

export interface AckDeps {
  redis: IORedis
  /** resolved per call: the token can be changed in /admin/settings at runtime */
  token: () => Promise<string>
  log: (msg: string, extra?: unknown) => void
}

/** callback_data budget is 64 bytes; "a:" + uuid is 38. */
export function ackButtons(eventId: string): unknown {
  return {
    inline_keyboard: [[
      { text: 'Принял', callback_data: `a:${eventId}` },
      { text: 'Ложное', callback_data: `f:${eventId}` },
    ]],
  }
}

async function tg(token: string, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout((POLL_TIMEOUT_SEC + 15) * 1000),
  })
  return res.json()
}

/** A chat may act on a tenant's events only if that tenant actually sends
 *  alerts there. Without this check, anyone who can press a button in any chat
 *  the bot serves could resolve another organisation's events by guessing an
 *  event id — the same tenant isolation the REST API enforces via JWT. */
async function chatMayActFor(tenantId: string, chatId: string): Promise<boolean> {
  const rules = await db.select({ channels: alertRule.channels })
    .from(alertRule)
    .where(and(eq(alertRule.tenantId, tenantId), eq(alertRule.enabled, true)))
  for (const r of rules) {
    if (!Array.isArray(r.channels)) continue
    for (const ch of r.channels as Array<Record<string, unknown>>) {
      if (ch?.type === 'telegram' && String(ch.chat_id) === chatId) return true
    }
  }
  return false
}

async function handleCallback(
  cq: z.infer<typeof CallbackQuery>, deps: AckDeps, token: string,
): Promise<void> {
  const answer = async (text: string): Promise<void> => {
    await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text })
      .catch(() => undefined)
  }

  const data = cq.data ?? ''
  const action = data.slice(0, 2)
  const eventId = data.slice(2)
  if ((action !== 'a:' && action !== 'f:') || !eventId) return

  const [ev] = await db.select({ tenantId: event.tenantId, type: event.type })
    .from(event).where(eq(event.id, eventId)).limit(1)
  if (!ev) { await answer('Событие не найдено'); return }

  const chatId = String(cq.message?.chat.id ?? '')
  if (!chatId || !(await chatMayActFor(ev.tenantId, chatId))) {
    deps.log('tg ack: chat not authorized', { chatId, eventId })
    await answer('Этот чат не связан с организацией события')
    return
  }

  const name = cq.from.username
    ? `@${cq.from.username}`
    : (cq.from.first_name ?? `tg:${cq.from.id}`)
  const actor = { tenantId: ev.tenantId, userId: null, via: 'telegram', name }

  let verdict: string
  if (action === 'a:') {
    const row = await resolveEvent(eventId, actor)
    if (!row) { await answer('Событие не найдено'); return }
    verdict = `Принял: ${name}`
  } else {
    const row = await markFalsePositive(eventId, actor, true, deps.redis)
    if (!row) { await answer('Событие не найдено'); return }
    verdict = `Ложное (${name})`
  }

  await answer(verdict)
  // Replace the buttons with the outcome: the next person opening the chat
  // sees it is handled instead of pressing again.
  if (cq.message) {
    await tg(token, 'editMessageReplyMarkup', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: `✓ ${verdict}`, callback_data: 'done' }]] },
    }).catch(() => undefined)
  }
  deps.log('tg ack', { eventId, type: TYPE_LABELS[ev.type] ?? ev.type, action, by: name })
}

/** Runs until the process exits. Never throws: a Telegram outage must not take
 *  the alerts worker down with it. */
export async function runTelegramAckPoller(deps: AckDeps): Promise<void> {
  let backoff = 5_000
  for (;;) {
    try {
      const token = await deps.token()
      if (!token) { await sleep(60_000); continue }

      // one poller per bot, cluster-wide
      const got = await deps.redis.set(LOCK_KEY, process.pid.toString(), 'EX', LOCK_TTL_SEC, 'NX')
      if (got !== 'OK') { await sleep(30_000); continue }

      try {
        for (;;) {
          await deps.redis.expire(LOCK_KEY, LOCK_TTL_SEC)
          const offset = Number(await deps.redis.get(OFFSET_KEY)) || 0
          const raw = await tg(token, 'getUpdates', {
            offset, timeout: POLL_TIMEOUT_SEC, allowed_updates: ['callback_query'],
          })
          const parsed = GetUpdates.safeParse(raw)
          if (!parsed.success || !parsed.data.ok) {
            const why = parsed.success ? parsed.data.description : 'unparsable response'
            // A 409 here means a webhook is registered for this bot: getUpdates
            // and a webhook are mutually exclusive, and Telegram will keep
            // refusing until one of them goes.
            deps.log('tg ack: getUpdates failed', {
              why,
              hint: String(why).includes('409')
                ? 'a webhook is set for this bot — remove it: '
                  + 'curl https://api.telegram.org/bot<TOKEN>/deleteWebhook'
                : undefined,
            })
            throw new Error(String(why))
          }
          for (const u of parsed.data.result ?? []) {
            await deps.redis.set(OFFSET_KEY, String(u.update_id + 1))
            if (u.callback_query) {
              await handleCallback(u.callback_query, deps, token).catch((err: unknown) => {
                deps.log('tg ack: handler failed', {
                  error: err instanceof Error ? err.message : String(err),
                })
              })
            }
          }
          backoff = 5_000
        }
      } finally {
        await deps.redis.del(LOCK_KEY).catch(() => undefined)
      }
    } catch (err) {
      deps.log('tg ack: poller restarting', {
        error: err instanceof Error ? err.message : String(err),
        inSeconds: backoff / 1000,
      })
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 300_000)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
