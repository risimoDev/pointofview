import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { site, tenantFeature } from '../../db/schema.js'
import { config } from '../config.js'
import { minio, minioPublic } from '../minio.js'
import { writeAudit } from '../audit.js'

// Redis keys owned by the analyzer's IdentityManager (embeddings included) —
// this API only reads galleries and manages the persistent staff hash.
const galleryKey = (siteId: string): string => `reid:gallery:${siteId}`
const staffKey = (tenantId: string): string => `reid:staff:${tenantId}`

interface GalleryJson {
  emb?: number[]
  last_seen?: number
}
interface StaffJson {
  emb?: number[]
  name?: string
}

const StaffBody = z.object({
  staff: z.boolean(),
  name: z.string().max(80).optional(),
})

/** Embeddings are L2-normalized → cosine similarity is a plain dot product. */
function cos(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

async function reidMatchThreshold(tenantId: string): Promise<number> {
  const [row] = await db.select({ config: tenantFeature.config }).from(tenantFeature)
    .where(and(eq(tenantFeature.tenantId, tenantId), eq(tenantFeature.feature, 'reid')))
    .limit(1)
  const v = row?.config?.match_threshold
  return typeof v === 'number' && v > 0 && v <= 1 ? v : 0.88
}

async function removeCrop(tenantId: string, gid: string): Promise<void> {
  try {
    await minio.removeObject(config.MINIO_BUCKET_SNAPSHOTS, `reid/${tenantId}/${gid}.jpg`)
  } catch { /* crop may not exist */ }
}

const peopleRoutes: FastifyPluginAsyncZod = async (app) => {
  // Everyone recently seen at the tenant's sites + the staff roster.
  app.get('/people', {
    preHandler: [app.requireRole('super', 'admin')],
  }, async (req) => {
    const sites = await db.select({ id: site.id, name: site.name }).from(site)
      .where(eq(site.tenantId, req.tenantId))
    const staffRaw = await app.redis.hgetall(staffKey(req.tenantId))

    const items: {
      gid: string
      staff: boolean
      name: string | null
      lastSeen: number | null
      siteId: string | null
      siteName: string | null
      snapshotUrl: string
    }[] = []

    const presign = (gid: string): Promise<string> =>
      minioPublic.presignedGetObject(
        config.MINIO_BUCKET_SNAPSHOTS, `reid/${req.tenantId}/${gid}.jpg`, 3600,
      )

    for (const [gid, payload] of Object.entries(staffRaw)) {
      let name: string | null = null
      try { name = (JSON.parse(payload) as StaffJson).name ?? null } catch { /* keep null */ }
      items.push({
        gid, staff: true, name, lastSeen: null, siteId: null, siteName: null,
        snapshotUrl: await presign(gid),
      })
    }

    for (const s of sites) {
      const raw = await app.redis.hgetall(galleryKey(s.id))
      for (const [gid, payload] of Object.entries(raw)) {
        if (staffRaw[gid]) continue // already listed as staff
        let lastSeen: number | null = null
        try { lastSeen = (JSON.parse(payload) as GalleryJson).last_seen ?? null } catch { /* skip */ }
        items.push({
          gid, staff: false, name: null, lastSeen, siteId: s.id, siteName: s.name,
          snapshotUrl: await presign(gid),
        })
      }
    }

    // staff first, then most recently seen
    items.sort((a, b) => Number(b.staff) - Number(a.staff) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    return { items }
  })

  // Toggle staff status. Marking copies the person's embedding from a site
  // gallery into the persistent staff hash; the analyzer reloads it within ~10s
  // and stops counting/alerting on that person everywhere on the site.
  app.post('/people/:gid/staff', {
    preHandler: [app.requireRole('super', 'admin')],
    schema: { params: z.object({ gid: z.string().min(1).max(64) }), body: StaffBody },
  }, async (req, reply) => {
    const { gid } = req.params
    const { staff, name } = req.body

    if (!staff) {
      await app.redis.hdel(staffKey(req.tenantId), gid)
      await writeAudit({
        tenantId: req.tenantId, userId: req.userId, action: 'person.unstaff',
        resourceType: 'person', resourceId: gid,
      })
      return { gid, staff: false }
    }

    // find the freshest embedding for this gid across the tenant's galleries
    const sites = await db.select({ id: site.id }).from(site)
      .where(eq(site.tenantId, req.tenantId))
    let emb: number[] | null = null
    for (const s of sites) {
      const payload = await app.redis.hget(galleryKey(s.id), gid)
      if (!payload) continue
      try {
        const parsed = JSON.parse(payload) as GalleryJson
        if (Array.isArray(parsed.emb)) { emb = parsed.emb; break }
      } catch { /* try next site */ }
    }
    // re-marking an existing staff member (e.g. to rename) keeps their embedding
    if (!emb) {
      const existing = await app.redis.hget(staffKey(req.tenantId), gid)
      if (existing) {
        try { emb = (JSON.parse(existing) as StaffJson).emb ?? null } catch { /* fallthrough */ }
      }
    }
    if (!emb) return reply.code(404).send({ message: 'identity not found (gallery expired?)' })

    await app.redis.hset(staffKey(req.tenantId), gid, JSON.stringify({ emb, name: name ?? null }))

    // Absorb duplicates: the same person often minted several visitor
    // identities before being marked (night/IR, re-entries). Drop every
    // gallery entry similar to the new staff embedding so they stop showing
    // up as visitors; the analyzer picks the deletions up on its next sync.
    const thr = await reidMatchThreshold(req.tenantId)
    let absorbed = 0
    for (const s of sites) {
      const raw = await app.redis.hgetall(galleryKey(s.id))
      const drop: string[] = []
      for (const [g, payload] of Object.entries(raw)) {
        if (g === gid) { drop.push(g); continue }
        try {
          const e = (JSON.parse(payload) as GalleryJson).emb
          if (Array.isArray(e) && cos(e, emb) >= thr) drop.push(g)
        } catch { /* skip bad entry */ }
      }
      if (drop.length > 0) {
        await app.redis.hdel(galleryKey(s.id), ...drop)
        // keep the marked gid's crop — it's the staff photo on «Люди»
        for (const g of drop) if (g !== gid) await removeCrop(req.tenantId, g)
        absorbed += drop.filter((g) => g !== gid).length
      }
    }

    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'person.staff',
      resourceType: 'person', resourceId: gid, details: { name: name ?? null, absorbed },
    })
    return { gid, staff: true, absorbed }
  })

  // Remove a visitor identity everywhere (galleries + crop). For staff use
  // the unstaff toggle first; this also drops a staff row if present.
  app.delete('/people/:gid', {
    preHandler: [app.requireRole('super', 'admin')],
    schema: { params: z.object({ gid: z.string().min(1).max(64) }) },
  }, async (req) => {
    const { gid } = req.params
    const sites = await db.select({ id: site.id }).from(site)
      .where(eq(site.tenantId, req.tenantId))
    for (const s of sites) await app.redis.hdel(galleryKey(s.id), gid)
    await app.redis.hdel(staffKey(req.tenantId), gid)
    await removeCrop(req.tenantId, gid)
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'person.delete',
      resourceType: 'person', resourceId: gid,
    })
    return { deleted: true }
  })
}

export default peopleRoutes
