import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { db } from '../db/client.js'
import { tenant } from '../../db/schema.js'
import { config } from '../config.js'
import { minio, minioPublic } from '../minio.js'
import { writeAudit } from '../audit.js'

// Training-data curation (super only). Every «ложное» mark on /events copies
// the frame into MinIO fp/{tenant}/{type}/{event}.jpg — that pile is the
// fine-tuning dataset for the detection models. This module lets the platform
// operator review it from the panel: browse per type, weed out bad samples,
// and hand the set to the (future) trainer. Actual GPU fine-tuning is stage 2
// — see PLAN «Обучение из панели».

const FP_PREFIX = (tenantId: string): string => `fp/${tenantId}/`

interface FpObject {
  key: string
  type: string
  size: number
  lastModified: string
}

async function listFp(tenantId: string, type?: string): Promise<FpObject[]> {
  const prefix = type ? `${FP_PREFIX(tenantId)}${type}/` : FP_PREFIX(tenantId)
  const out: FpObject[] = []
  const stream = minio.listObjectsV2(config.MINIO_BUCKET_SNAPSHOTS, prefix, true)
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (obj) => {
      if (!obj.name) return
      const parts = obj.name.split('/') // fp/{tenant}/{type}/{event}.jpg
      out.push({
        key: obj.name,
        type: parts[2] ?? 'unknown',
        size: obj.size ?? 0,
        lastModified: obj.lastModified?.toISOString() ?? '',
      })
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return out
}

const trainingRoutes: FastifyPluginAsyncZod = async (app) => {
  const requireSuper = app.requireRole('super')

  // Dataset overview across ALL tenants (platform-level: models are shared).
  app.get('/training/summary', { preHandler: [requireSuper] }, async () => {
    const tenants = await db.select({ id: tenant.id, name: tenant.name }).from(tenant)
    const rows: { tenantId: string; tenantName: string; type: string; count: number }[] = []
    for (const t of tenants) {
      const objs = await listFp(t.id)
      const byType = new Map<string, number>()
      for (const o of objs) byType.set(o.type, (byType.get(o.type) ?? 0) + 1)
      for (const [type, count] of byType) {
        rows.push({ tenantId: t.id, tenantName: t.name, type, count })
      }
    }
    return { items: rows }
  })

  // Samples of one tenant+type with view URLs (short-lived).
  app.get('/training/items', {
    preHandler: [requireSuper],
    schema: {
      querystring: z.object({
        tenant_id: z.string().uuid(),
        type: z.string().min(1).max(40),
        limit: z.coerce.number().int().min(1).max(200).default(60),
      }),
    },
  }, async (req) => {
    const objs = (await listFp(req.query.tenant_id, req.query.type))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      .slice(0, req.query.limit)
    const items = await Promise.all(objs.map(async (o) => ({
      key: o.key,
      size: o.size,
      lastModified: o.lastModified,
      url: await minioPublic.presignedGetObject(config.MINIO_BUCKET_SNAPSHOTS, o.key, 3600),
    })))
    return { items }
  })

  // Weed out a bad sample (blurry frame, wrong mark) — dataset hygiene.
  app.delete('/training/items', {
    preHandler: [requireSuper],
    schema: { body: z.object({ keys: z.array(z.string().min(1)).min(1).max(500) }) },
  }, async (req) => {
    // only fp/ objects are deletable through here, whatever the client sends
    const keys = req.body.keys.filter((k) => k.startsWith('fp/'))
    if (keys.length > 0) {
      await minio.removeObjects(config.MINIO_BUCKET_SNAPSHOTS, keys)
    }
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'training.samples_delete',
      resourceType: 'training', resourceId: 'fp', details: { count: keys.length },
    })
    return { deleted: keys.length }
  })
}

export default trainingRoutes
