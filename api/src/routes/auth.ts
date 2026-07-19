import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { appUser } from '../../db/schema.js'
import { LoginBody } from '../schemas.js'
import { clientIp, rateLimit } from '../ratelimit.js'
import { sanitizePerms } from '../permissions.js'

// Brute-force protection: fixed windows per client IP (password spraying
// across accounts) AND per email (single-account brute force with rotating
// IPs). Successful login clears both counters.
const LOGIN_WINDOW_SEC = 15 * 60
const LOGIN_IP_LIMIT = 10
const LOGIN_EMAIL_LIMIT = 5

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/login', {
    schema: {
      body: LoginBody,
      response: {
        200: z.object({ token: z.string() }),
        401: z.object({ message: z.string() }),
        429: z.object({ message: z.string() }),
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body
    const ipKey = `login_rl:ip:${clientIp(req)}`
    const emailKey = `login_rl:email:${email.toLowerCase()}`
    const byIp = await rateLimit(app.redis, ipKey, LOGIN_IP_LIMIT, LOGIN_WINDOW_SEC)
    const byEmail = await rateLimit(app.redis, emailKey, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_SEC)
    if (!byIp.allowed || !byEmail.allowed) {
      const retryAfter = Math.max(byIp.retryAfterSec, byEmail.retryAfterSec)
      return reply.code(429).header('Retry-After', String(retryAfter))
        .send({ message: 'too many login attempts, try again later' })
    }

    const [user] = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1)
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ message: 'invalid credentials' })
    }
    if (user.disabled) {
      return reply.code(401).send({ message: 'account disabled' })
    }
    await app.redis.del(ipKey, emailKey)
    const token = app.jwt.sign({
      tenant_id: user.tenantId,
      user_id: user.id,
      role: user.role,
      // permission edits take effect on next login (JWT is self-contained)
      perms: sanitizePerms(user.permissions),
      cams: user.allowedCameraIds ?? [],
    })
    return { token }
  })
}

export default authRoutes
