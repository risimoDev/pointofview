import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { config } from '../config.js'
import { settingSecret, settingText } from '../settings.js'

// Unauthenticated endpoints for the public landing page.

const DemoRequestBody = z.object({
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().min(3).max(200), // phone or @telegram
  object_type: z.enum(['pvz', 'production', 'retail', 'office', 'other']),
  cameras: z.string().trim().max(40).optional(),
  comment: z.string().trim().max(1000).optional(),
})

const OBJECT_LABELS: Record<string, string> = {
  pvz: 'ПВЗ',
  production: 'Производство',
  retail: 'Ритейл',
  office: 'Офис',
  other: 'Другое',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/demo-request', {
    schema: { body: DemoRequestBody },
  }, async (req, reply) => {
    // rate limit: 5 requests per hour per IP (public, unauthenticated)
    const rlKey = `demo_req:${req.ip}`
    const hits = await app.redis.incr(rlKey)
    if (hits === 1) await app.redis.expire(rlKey, 3600)
    if (hits > 5) return reply.code(429).send({ message: 'Слишком много заявок, попробуйте позже' })

    const chatId = await settingText('lead_telegram_chat_id')
    const token = (await settingSecret('telegram_bot_token')) || config.TELEGRAM_BOT_TOKEN
    if (!chatId || !token) {
      return reply.code(503).send({
        message: 'Приём заявок временно недоступен. Напишите нам напрямую.',
      })
    }

    const b = req.body
    const text = [
      '📩 <b>Заявка на демо с сайта</b>',
      `Имя: ${escapeHtml(b.name)}`,
      `Контакт: ${escapeHtml(b.contact)}`,
      `Объект: ${OBJECT_LABELS[b.object_type] ?? b.object_type}`,
      b.cameras ? `Камер: ${escapeHtml(b.cameras)}` : null,
      b.comment ? `Комментарий: ${escapeHtml(b.comment)}` : null,
    ].filter((l): l is string => l !== null).join('\n')

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json()) as { ok: boolean; description?: string }
    if (!data.ok) {
      req.log.error({ description: data.description }, 'demo-request: telegram send failed')
      return reply.code(502).send({ message: 'Не удалось отправить заявку, попробуйте позже' })
    }
    return reply.code(201).send({ sent: true })
  })
}

export default publicRoutes
