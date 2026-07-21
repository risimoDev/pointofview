import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type Redis from 'ioredis'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { camera, site, tenantFeature } from '../../db/schema.js'
import { writeAudit } from '../audit.js'
import { FeatureParams, UpsertFeatureBody } from '../schemas.js'
import {
  VLM_TIMEOUT_MS, VLM_WORKER_ALIVE_KEY, ollamaHealth, ollamaText, vlmSettings, vlmStatsKey,
} from '../vlm.js'

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
    preHandler: [app.requirePerm('features')],
  }, async (req) => {
    const rows = await db.select({
      feature: tenantFeature.feature,
      enabled: tenantFeature.enabled,
      config: tenantFeature.config,
    }).from(tenantFeature).where(eq(tenantFeature.tenantId, req.tenantId))
    return { items: rows }
  })

  // Analyzer-published plugin/model state (plugin_status:{tenant}) and
  // capacity metrics (analyzer_metrics:{tenant}). Both keys are TTL'd by the
  // analyzer: absence means the analyzer is down or hasn't ticked yet.
  app.get('/features/status', {
    preHandler: [app.requirePerm('features')],
  }, async (req) => {
    const [rawStatus, rawMetrics] = await app.redis.mget(
      `plugin_status:${req.tenantId}`,
      `analyzer_metrics:${req.tenantId}`,
    )
    return {
      items: rawStatus ? JSON.parse(rawStatus) as unknown[] : [],
      metrics: rawMetrics ? JSON.parse(rawMetrics) as Record<string, unknown> : null,
    }
  })

  // Health of the local-VLM chain (worker-ai → Ollama → model) plus the
  // counters the worker writes. Answers «почему ИИ молчит» from the panel
  // instead of the server console.
  app.get('/features/vlm/status', {
    preHandler: [app.requirePerm('features')],
  }, async (req) => {
    const settings = await vlmSettings(req.tenantId)
    const [health, alive, stats] = await Promise.all([
      ollamaHealth(),
      app.redis.get(VLM_WORKER_ALIVE_KEY),
      app.redis.hgetall(vlmStatsKey(req.tenantId)),
    ])
    // ollama reports tags as "name:tag"; a bare "qwen3-vl:4b" must match
    const modelPresent = health.models.some(
      (m) => m === settings.model || m.split(':')[0] === settings.model.split(':')[0],
    )
    const num = (k: string): number => Number(stats[k] ?? 0)
    return {
      enabled: settings.enabled,
      verify: settings.verify,
      autoVerifyAfter: settings.autoVerifyAfter,
      model: settings.model,
      workerAlive: alive !== null,
      ollamaOk: health.ok,
      ollamaError: health.error,
      models: health.models,
      modelPresent,
      stats: {
        jobs: num('jobs'),
        described: num('described'),
        verified: num('verified'),
        suppressed: num('suppressed'),
        stale: num('stale'),
        skipped: num('skipped'),
        failed: num('failed'),
        lastError: stats.last_error ?? null,
      },
    }
  })

  // One real generation against the configured model: proves the chain works
  // and — more importantly — how long it takes. Slower than VLM_TIMEOUT_MS
  // means every verification silently fails open.
  app.post('/features/vlm/test', {
    preHandler: [app.requirePerm('features')],
  }, async (req) => {
    const settings = await vlmSettings(req.tenantId)
    const started = Date.now()
    try {
      const answer = await ollamaText(
        settings.model,
        'Ответь одним словом: работаешь?',
        VLM_TIMEOUT_MS,
      )
      return {
        ok: true, ms: Date.now() - started, model: settings.model,
        answer: answer ?? '', error: null,
      }
    } catch (err) {
      return {
        ok: false, ms: Date.now() - started, model: settings.model, answer: '',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  app.put('/features/:feature', {
    preHandler: [app.requirePerm('features')],
    schema: { params: FeatureParams, body: UpsertFeatureBody },
  }, async (req, reply) => {
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

  // Live metrics written by the counter plugin:
  //   occupancy:{tenant} per camera; visitors:{tenant} per SITE (deduped by
  //   cross-camera identity when reid is on — a person on 4 cameras counts once)
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
        // legacy rows may still carry visitors — ignored since the per-site hash took over
        const v = JSON.parse(json) as { occupancy: number; ts: number }
        return { cameraId, occupancy: v.occupancy, ts: v.ts }
      })

    const sitesRaw = await app.redis.hgetall(`visitors:${req.tenantId}`)
    const names = await db.select({ id: site.id, name: site.name }).from(site)
      .where(eq(site.tenantId, req.tenantId))
    const nameById = new Map(names.map((s) => [s.id, s.name]))
    const sites = Object.entries(sitesRaw)
      .filter(([siteId]) => nameById.has(siteId))
      .map(([siteId, json]) => {
        const v = JSON.parse(json) as { visitors: number; day: string; ts: number }
        return { siteId, siteName: nameById.get(siteId) ?? '', visitors: v.visitors, ts: v.ts }
      })

    return { items, sites }
  })
}

export default featuresRoutes
