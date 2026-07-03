import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import { config } from '../config.js'

export interface JwtPayload {
  tenant_id: string
  user_id: string
  role: 'super' | 'admin' | 'manager' | 'operator'
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>
    requireRole: (
      ...roles: JwtPayload['role'][]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    tenantId: string
    userId: string
    role: JwtPayload['role']
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyJwt, { secret: config.JWT_SECRET })

  app.decorate('authenticate', async (req: FastifyRequest) => {
    await req.jwtVerify()
    req.tenantId = req.user.tenant_id
    req.userId = req.user.user_id
    req.role = req.user.role
  })

  // Verify JWT then require one of the given roles (403 otherwise).
  app.decorate('requireRole', (...roles: JwtPayload['role'][]) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await req.jwtVerify()
      req.tenantId = req.user.tenant_id
      req.userId = req.user.user_id
      req.role = req.user.role
      if (!roles.includes(req.role)) {
        await reply.code(403).send({ message: 'insufficient role' })
      }
    })
}

export default fp(authPlugin, { name: 'auth' })
