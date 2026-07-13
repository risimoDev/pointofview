import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { site, tenantFeature } from '../../db/schema.js'
import { config } from '../config.js'
import { minio, minioPublic } from '../minio.js'
import { writeAudit } from '../audit.js'

// Redis keys owned by the analyzer's IdentityManager (embeddings included) —
// this API only reads galleries and manages the persistent staff hashes.
const galleryKey = (siteId: string): string => `reid:gallery:${siteId}`
const staffKey = (tenantId: string): string => `reid:staff:${tenantId}`
const faceStaffKey = (tenantId: string): string => `face:staff:${tenantId}`
const faceEnrollKey = (tenantId: string): string => `face_enroll:${tenantId}`

const MAX_STAFF_EMBS = 8

interface GalleryJson {
  emb?: number[]
  last_seen?: number
}
// staff payload: multi-sample {embs} is current; single {emb} is legacy
interface StaffJson {
  emb?: number[]
  embs?: number[][]
  name?: string
}
interface FaceStaffJson {
  embs?: number[][]
  photos?: number
  failed?: number
}

function staffEmbs(parsed: StaffJson): number[][] {
  if (Array.isArray(parsed.embs)) return parsed.embs.filter((e) => Array.isArray(e))
  return Array.isArray(parsed.emb) ? [parsed.emb] : []
}

const StaffBody = z.object({
  staff: z.boolean(),
  name: z.string().max(80).optional(),
  // add this person as another sample of an existing staff member
  merge_into: z.string().min(1).max(64).optional(),
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

/** Queue the person's camera crop for face enrollment (analyzer consumes). */
async function queueFaceEnrollFromCrop(
  redis: { rpush: (key: string, value: string) => Promise<number> },
  tenantId: string, targetGid: string, cropGid: string,
): Promise<void> {
  try {
    const stream = await minio.getObject(config.MINIO_BUCKET_SNAPSHOTS, `reid/${tenantId}/${cropGid}.jpg`)
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(c as Buffer)
    await redis.rpush(faceEnrollKey(tenantId), JSON.stringify({
      gid: targetGid, jpeg_b64: Buffer.concat(chunks).toString('base64'),
    }))
  } catch { /* crop missing — face sample simply not added */ }
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
      clothingSamples: number
      faceSamples: number
    }[] = []

    const presign = (gid: string): Promise<string> =>
      minioPublic.presignedGetObject(
        config.MINIO_BUCKET_SNAPSHOTS, `reid/${req.tenantId}/${gid}.jpg`, 3600,
      )

    const faceRaw = await app.redis.hgetall(faceStaffKey(req.tenantId))
    const faceCount = (gid: string): number => {
      const payload = faceRaw[gid]
      if (!payload) return 0
      try { return ((JSON.parse(payload) as FaceStaffJson).embs ?? []).length } catch { return 0 }
    }

    for (const [gid, payload] of Object.entries(staffRaw)) {
      let name: string | null = null
      let clothing = 0
      try {
        const parsed = JSON.parse(payload) as StaffJson
        name = parsed.name ?? null
        clothing = staffEmbs(parsed).length
      } catch { /* keep defaults */ }
      items.push({
        gid, staff: true, name, lastSeen: null, siteId: null, siteName: null,
        snapshotUrl: await presign(gid),
        clothingSamples: clothing, faceSamples: faceCount(gid),
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
          clothingSamples: 0, faceSamples: 0,
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
    const { staff, name, merge_into } = req.body

    if (!staff) {
      await app.redis.hdel(staffKey(req.tenantId), gid)
      await app.redis.hdel(faceStaffKey(req.tenantId), gid)
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

    // target staff record: an existing member (merge) or this gid itself
    const targetGid = merge_into && merge_into !== gid ? merge_into : gid
    let embs: number[][] = []
    let finalName: string | null = name ?? null
    const existingRaw = await app.redis.hget(staffKey(req.tenantId), targetGid)
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw) as StaffJson
        embs = staffEmbs(parsed)
        finalName = name ?? parsed.name ?? null
      } catch { /* start fresh */ }
    } else if (targetGid !== gid) {
      return reply.code(404).send({ message: 'staff person to merge into not found' })
    }
    if (emb) embs = [...embs, emb].slice(-MAX_STAFF_EMBS)
    if (embs.length === 0) {
      return reply.code(404).send({ message: 'identity not found (gallery expired?)' })
    }

    await app.redis.hset(staffKey(req.tenantId), targetGid,
      JSON.stringify({ embs, name: finalName }))

    // Absorb duplicates: the same person often minted several visitor
    // identities before being marked (night/IR, re-entries). Drop every
    // gallery entry similar to any of the staff samples so they stop showing
    // up as visitors; the analyzer picks the deletions up on its next sync.
    const thr = await reidMatchThreshold(req.tenantId)
    let absorbed = 0
    for (const s of sites) {
      const raw = await app.redis.hgetall(galleryKey(s.id))
      const drop: string[] = []
      for (const [g, payload] of Object.entries(raw)) {
        if (g === gid || g === targetGid) { drop.push(g); continue }
        try {
          const e = (JSON.parse(payload) as GalleryJson).emb
          if (Array.isArray(e) && Math.max(...embs.map((se) => cos(e, se))) >= thr) drop.push(g)
        } catch { /* skip bad entry */ }
      }
      if (drop.length > 0) {
        await app.redis.hdel(galleryKey(s.id), ...drop)
        // keep the target's crop — it's the staff photo on «Люди»
        for (const g of drop) if (g !== targetGid) await removeCrop(req.tenantId, g)
        absorbed += drop.filter((g) => g !== targetGid).length
      }
    }

    // the person's camera crop doubles as a face sample (analyzer extracts it)
    await queueFaceEnrollFromCrop(app.redis, req.tenantId, targetGid, gid)

    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'person.staff',
      resourceType: 'person', resourceId: targetGid,
      details: { name: finalName, absorbed, merged_from: targetGid !== gid ? gid : null },
    })
    return { gid: targetGid, staff: true, absorbed }
  })

  // Upload a clean face photo for a staff member (biometrics of employees
  // only — with their written consent; visitors are never face-matched).
  app.post('/people/:gid/face-photo', {
    preHandler: [app.requireRole('super', 'admin')],
    schema: { params: z.object({ gid: z.string().min(1).max(64) }) },
  }, async (req, reply) => {
    const { gid } = req.params
    const staffRaw = await app.redis.hget(staffKey(req.tenantId), gid)
    if (!staffRaw) return reply.code(404).send({ message: 'not a staff person' })

    const file = await req.file()
    if (!file) return reply.code(400).send({ message: 'no photo in request' })
    const buf = await file.toBuffer()
    if (buf.length > 8 * 1024 * 1024) {
      return reply.code(413).send({ message: 'photo larger than 8 MB' })
    }
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8
    const png = buf[0] === 0x89 && buf[1] === 0x50
    if (!jpeg && !png) return reply.code(400).send({ message: 'JPEG or PNG expected' })

    await app.redis.rpush(faceEnrollKey(req.tenantId), JSON.stringify({
      gid, jpeg_b64: buf.toString('base64'),
    }))
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'person.face_photo',
      resourceType: 'person', resourceId: gid, details: { bytes: buf.length },
    })
    return reply.code(202).send({ queued: true })
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
    await app.redis.hdel(faceStaffKey(req.tenantId), gid)
    await removeCrop(req.tenantId, gid)
    await writeAudit({
      tenantId: req.tenantId, userId: req.userId, action: 'person.delete',
      resourceType: 'person', resourceId: gid,
    })
    return { deleted: true }
  })
}

export default peopleRoutes
