import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type Redis from 'ioredis'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { camera, site, tenantFeature } from '../../db/schema.js'
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
    // only surface cameras that still exist — deleting a camera used to leave a
    // stale occupancy row that kept showing on the dashboard
    const live = await db.select({ id: camera.id }).from(camera)
      .innerJoin(site, eq(camera.siteId, site.id))
      .where(eq(site.tenantId, req.tenantId))
    const liveIds = new Set(live.map((c) => c.id))
    const stale = Object.keys(raw).filter((id) => !liveIds.has(id))
    if (stale.length > 0) await app.redis.hdel(`occupancy:${req.tenantId}`, ...stale)
    const items = Object.entries(raw)
      .filter(([cameraId]) => liveIds.has(cameraId))
      .map(([cameraId, json]) => {
        const v = JSON.parse(json) as { occupancy: number; visitors: number; ts: number }
        return { cameraId, occupancy: v.occupancy, visitors: v.visitors, ts: v.ts }
      })
    return { items }
  })
}

export default featuresRoutes
