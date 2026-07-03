import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type Redis from 'ioredis'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { tenantFeature } from '../../db/schema.js'
import { writeAudit } from '../audit.js'
import { FeatureParams, UpsertFeatureBody } from '../schemas.js'

/** Rebuild Redis features:{tenant} object consumed by the analyzer plugins:
 *  { feature_id: { enabled, config } } — see PluginManager.load_features. */
async function syncFeatures(app: { redis: Redis }, tenantId: string): Promise<void> {
  const rows = await db.select({
    feature: tenantFeature.feature,
    enabled: tenantFeature.enabled,
    config: tenantFeature.config,
  }).from(tenantFeature).where(eq(tenantFeature.tenantId, tenantId))
  const obj: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {}
  for (const r of rows) obj[r.feature] = { enabled: r.enabled, config: r.config }
  await app.redis.set(`features:${tenantId}`, JSON.stringify(obj))
}

const featuresRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/features', {
    preHandler: [app.authenticate],
  }, async (req) => {
    const rows = await db.select({
      feature: tenantFeature.feature,
      enabled: tenantFeature.enabled,
      config: tenantFeature.config,
    }).from(tenantFeature).where(eq(tenantFeature.tenantId, req.tenantId))
    return { items: rows }
  })

  app.put('/features/:feature', {
    preHandler: [app.authenticate],
    schema: { params: FeatureParams, body: UpsertFeatureBody },
  }, async (req, reply) => {
    if (req.role !== 'admin' && req.role !== 'super') {
      return reply.code(403).send({ message: 'admin role required' })
    }
    const { feature } = req.params
    const { enabled, config } = req.body
    const [row] = await db.insert(tenantFeature).values({
      tenantId: req.tenantId, feature, enabled, config,
    }).onConflictDoUpdate({
      target: [tenantFeature.tenantId, tenantFeature.feature],
      set: { enabled, config },
    }).returning()

    await syncFeatures(app, req.tenantId)
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'feature.update',
      resourceType: 'feature', resourceId: feature, details: { enabled },
    })
    return row
  })

  // Live occupancy/visitors written by the counter plugin to occupancy:{tenant}
  app.get('/occupancy', {
    preHandler: [app.authenticate],
  }, async (req) => {
    const raw = await app.redis.hgetall(`occupancy:${req.tenantId}`)
    const items = Object.entries(raw).map(([cameraId, json]) => {
      const v = JSON.parse(json) as { occupancy: number; visitors: number; ts: number }
      return { cameraId, occupancy: v.occupancy, visitors: v.visitors, ts: v.ts }
    })
    return { items }
  })
}

export default featuresRoutes
