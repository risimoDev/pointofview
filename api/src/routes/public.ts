import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import bcrypt from 'bcryptjs'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { appUser, tenant, userInvite } from '../../db/schema.js'
import { config } from '../config.js'
import { settingSecret, settingText } from '../settings.js'
import { clientIp, rateLimit } from '../ratelimit.js'
import { writeAudit } from '../audit.js'

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
  // ── Invite acceptance (unauthenticated; the link IS the credential) ──
  const liveInvite = (token: string) => and(
    eq(userInvite.token, token),
    isNull(userInvite.usedAt),
    gt(userInvite.expiresAt, new Date()),
  )

  app.get('/invite/:token', {
    schema: { params: z.object({ token: z.string().min(10).max(128) }) },
  }, async (req, reply) => {
    const [inv] = await db.select({
      name: userInvite.name, email: userInvite.email, role: userInvite.role,
      tenantId: userInvite.tenantId,
    }).from(userInvite).where(liveInvite(req.params.token)).limit(1)
    if (!inv) return reply.code(404).send({ message: 'Приглашение не найдено или истекло' })
    const [org] = await db.select({ name: tenant.name }).from(tenant)
      .where(eq(tenant.id, inv.tenantId)).limit(1)
    return { name: inv.name, email: inv.email, role: inv.role, orgName: org?.name ?? '' }
  })

  app.post('/invite/:token/accept', {
    schema: {
      params: z.object({ token: z.string().min(10).max(128) }),
      body: z.object({
        email: z.string().email(),
        password: z.string().min(8).max(128),
        name: z.string().trim().max(80).optional(),
      }),
    },
  }, async (req, reply) => {
    // brute-forcing tokens is pointless (24 random bytes) but rate-limit anyway
    const rl = await rateLimit(app.redis, `invite_rl:${clientIp(req)}`, 10, 3600)
    if (!rl.allowed) {
      return reply.code(429).header('Retry-After', String(rl.retryAfterSec))
        .send({ message: 'Слишком много попыток, попробуйте позже' })
    }
    const [inv] = await db.select().from(userInvite)
      .where(liveInvite(req.params.token)).limit(1)
    if (!inv) return reply.code(404).send({ message: 'Приглашение не найдено или истекло' })

    const passwordHash = await bcrypt.hash(req.body.password, 10)
    try {
      const [user] = await db.insert(appUser).values({
        tenantId: inv.tenantId,
        email: req.body.email,
        passwordHash,
        role: inv.role,
        name: req.body.name ?? inv.name,
        permissions: inv.permissions,
        allowedCameraIds: inv.allowedCameraIds,
      }).returning({ id: appUser.id })
      await db.update(userInvite).set({ usedAt: new Date() })
        .where(eq(userInvite.id, inv.id))
      await writeAudit({
        tenantId: inv.tenantId, userId: user!.id, action: 'invite.accept',
        resourceType: 'user', resourceId: user!.id, details: { email: req.body.email },
      })
      return reply.code(201).send({ created: true })
    } catch {
      return reply.code(409).send({ message: 'Эта почта уже зарегистрирована' })
    }
  })

  app.post('/demo-request', {
    schema: { body: DemoRequestBody },
  }, async (req, reply) => {
    // rate limit: 5 requests per hour per IP (public, unauthenticated).
    // clientIp, not req.ip: behind nginx req.ip is the proxy container —
    // the limit would silently become global for every visitor.
    const rlKey = `demo_req:${clientIp(req)}`
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
