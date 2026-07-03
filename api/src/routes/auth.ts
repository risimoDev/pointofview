import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { appUser } from '../../db/schema.js'
import { LoginBody } from '../schemas.js'

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/login', {
    schema: {
      body: LoginBody,
      response: {
        200: z.object({ token: z.string() }),
        401: z.object({ message: z.string() }),
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body
    const [user] = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1)
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ message: 'invalid credentials' })
    }
    const token = app.jwt.sign({
      tenant_id: user.tenantId,
      user_id: user.id,
      role: user.role,
    })
    return { token }
  })
}

export default authRoutes
