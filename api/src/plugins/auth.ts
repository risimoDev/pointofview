import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import { config } from '../config.js'
import { hasPerm, type PermissionCode } from '../permissions.js'

export interface JwtPayload {
  tenant_id: string
  user_id: string
  role: 'super' | 'admin' | 'manager' | 'operator'
  // capability checkboxes; absent/null = legacy role defaults
  perms?: string[] | null
  // camera restriction; absent/empty = all cameras
  cams?: string[]
  // super entered a tenant from the platform section (audited)
  imp?: boolean
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
    requirePerm: (
      code: PermissionCode,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    tenantId: string
    userId: string
    role: JwtPayload['role']
    perms: string[] | null
    allowedCameraIds: string[]
  }
}

function hydrate(req: FastifyRequest): void {
  req.tenantId = req.user.tenant_id
  req.userId = req.user.user_id
  req.role = req.user.role
  req.perms = req.user.perms ?? null
  req.allowedCameraIds = req.user.cams ?? []
}

const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyJwt, { secret: config.JWT_SECRET })

  app.decorate('authenticate', async (req: FastifyRequest) => {
    await req.jwtVerify()
    hydrate(req)
  })

  // Verify JWT then require one of the given roles (403 otherwise).
  app.decorate('requireRole', (...roles: JwtPayload['role'][]) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await req.jwtVerify()
      hydrate(req)
      if (!roles.includes(req.role)) {
        await reply.code(403).send({ message: 'insufficient role' })
      }
    })

  // Verify JWT then require a capability checkbox. super/admin always pass;
  // users without explicit checkboxes fall back to role defaults.
  app.decorate('requirePerm', (code: PermissionCode) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await req.jwtVerify()
      hydrate(req)
      if (!hasPerm(req.role, req.perms, code)) {
        await reply.code(403).send({ message: `permission required: ${code}` })
      }
    })
}

export default fp(authPlugin, { name: 'auth' })
