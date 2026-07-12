import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { site } from '../../db/schema.js'
import { config } from '../config.js'
import { minioPublic } from '../minio.js'
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
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'person.staff',
      resourceType: 'person', resourceId: gid, details: { name: name ?? null },
    })
    return { gid, staff: true }
  })
}

export default peopleRoutes
