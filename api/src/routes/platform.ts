import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { randomBytes } from 'node:crypto'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { appUser, camera, site, tenant, userInvite } from '../../db/schema.js'
import { writeAudit } from '../audit.js'

// Platform section: super only, CROSS-tenant by design. The super account
// belongs to the service, not to any customer organization — these routes
// deliberately ignore req.tenantId.

const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  const requireSuper = app.requireRole('super')

  // All organizations with headline numbers.
  app.get('/orgs', { preHandler: [requireSuper] }, async () => {
    const rows = await db.execute(sql`
      SELECT t.id, t.name, t.mode,
             count(DISTINCT s.id)::int AS sites,
             count(DISTINCT c.id)::int AS cameras,
             count(DISTINCT u.id)::int AS users
      FROM ${tenant} t
        LEFT JOIN ${site} s ON s.tenant_id = t.id
        LEFT JOIN ${camera} c ON c.site_id = s.id
        LEFT JOIN ${appUser} u ON u.tenant_id = t.id
      GROUP BY t.id, t.name, t.mode
      ORDER BY t.name
    `)
    return {
      items: rows.rows as unknown as {
        id: string; name: string; mode: string
        sites: number; cameras: number; users: number
      }[],
    }
  })

  // New organization: tenant + first site + invite link for the owner.
  app.post('/orgs', {
    preHandler: [requireSuper],
    schema: {
      body: z.object({
        name: z.string().trim().min(1).max(120),
        mode: z.enum(['cloud', 'onpremise']).default('cloud'),
        site_name: z.string().trim().min(1).max(120).default('Основная площадка'),
        timezone: z.string().default('Europe/Moscow'),
        owner_name: z.string().trim().max(80).default(''),
      }),
    },
  }, async (req, reply) => {
    const b = req.body
    const [org] = await db.insert(tenant)
      .values({ name: b.name, mode: b.mode }).returning()
    await db.insert(site).values({
      tenantId: org!.id, name: b.site_name, timezone: b.timezone,
    })
    const token = randomBytes(24).toString('base64url')
    await db.insert(userInvite).values({
      tenantId: org!.id, token, name: b.owner_name, role: 'admin',
      permissions: null, createdBy: req.userId,
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    })
    await writeAudit({
      tenantId: org!.id, userId: req.userId, action: 'org.create',
      resourceType: 'tenant', resourceId: org!.id, details: { name: b.name, mode: b.mode },
    })
    return reply.code(201).send({ id: org!.id, name: org!.name, owner_invite_token: token })
  })

  // Enter an organization for support: a fresh JWT scoped to that tenant with
  // owner rights, flagged imp (audited). The web swaps cookies and keeps the
  // super token aside to return.
  app.post('/orgs/:id/enter', {
    preHandler: [requireSuper],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req, reply) => {
    const [org] = await db.select({ id: tenant.id, name: tenant.name }).from(tenant)
      .where(eq(tenant.id, req.params.id)).limit(1)
    if (!org) return reply.code(404).send({ message: 'organization not found' })
    const token = app.jwt.sign({
      tenant_id: org.id,
      user_id: req.userId,
      role: 'admin',
      imp: true,
    })
    await writeAudit({
      tenantId: org.id, userId: req.userId, action: 'org.enter',
      resourceType: 'tenant', resourceId: org.id,
    })
    return { token, org_name: org.name }
  })

  // Pending owner invites (to re-copy a link)
  app.get('/orgs/:id/invites', {
    preHandler: [requireSuper],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (req) => {
    const rows = await db.select({
      id: userInvite.id, token: userInvite.token, role: userInvite.role,
      name: userInvite.name, expiresAt: userInvite.expiresAt, usedAt: userInvite.usedAt,
    }).from(userInvite).where(eq(userInvite.tenantId, req.params.id))
      .orderBy(desc(userInvite.createdAt)).limit(20)
    return { items: rows }
  })
}

export default platformRoutes
