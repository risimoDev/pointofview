import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { db } from '../db/client.js'
import { archiveSegment, camera, event, site } from '../../db/schema.js'
import { config } from '../config.js'

// In-browser video archive. The recorder writes ${ARCHIVE_ROOT}/{tenant}/{cam}/
// {ts}.mp4 segments and rows in archive_segment; this module lists them for a
// camera+time window and streams the mp4 with HTTP Range so the player can seek.
//
// Playback auth: a <video src> can't send the Authorization header, and the
// session JWT must never live in a URL (logs/caching). So listing (behind the
// normal perm check) mints a short-lived MEDIA TICKET — a separate JWT scoped
// to one camera — and the player passes it as ?t=. The stream route verifies
// the ticket itself; it grants nothing but reading that camera's segments.

const TICKET_TTL_SECONDS = 30 * 60

interface ArchiveTicket {
  typ: 'archive'
  tenant_id: string
  cam: string
}

async function ownsCamera(tenantId: string, cameraId: string): Promise<boolean> {
  const [row] = await db.select({ id: camera.id }).from(camera)
    .innerJoin(site, eq(camera.siteId, site.id))
    .where(and(eq(camera.id, cameraId), eq(site.tenantId, tenantId))).limit(1)
  return Boolean(row)
}

const RangeParams = z.object({ id: z.string().uuid() })
const RangeQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
})

const archiveRoutes: FastifyPluginAsyncZod = async (app) => {
  // Segments overlapping [from,to] for one camera + a playback ticket + the
  // events in the window (timeline markers → jump-to-moment).
  app.get('/cameras/:id/archive', {
    preHandler: [app.requirePerm('live')],
    schema: { params: RangeParams, querystring: RangeQuery },
  }, async (req, reply) => {
    const { id } = req.params
    if (req.allowedCameraIds.length > 0 && !req.allowedCameraIds.includes(id)) {
      return reply.code(403).send({ message: 'camera not allowed' })
    }
    if (!(await ownsCamera(req.tenantId, id))) {
      return reply.code(404).send({ message: 'camera not found' })
    }
    const from = new Date(req.query.from)
    const to = new Date(req.query.to)

    // a segment is in view if it starts before `to` and ends after `from`;
    // ended_at may be null for the tail segment → fall back to started_at
    const rows = await db.select({
      id: archiveSegment.id,
      startedAt: archiveSegment.startedAt,
      endedAt: archiveSegment.endedAt,
      sizeBytes: archiveSegment.sizeBytes,
    }).from(archiveSegment)
      .where(and(
        eq(archiveSegment.cameraId, id),
        lte(archiveSegment.startedAt, to),
        gte(archiveSegment.startedAt, new Date(from.getTime() - 6 * 3600_000)),
      ))
      .orderBy(asc(archiveSegment.startedAt))

    const segments = rows.filter((r) => (r.endedAt ?? r.startedAt) >= from)

    const events = await db.select({
      id: event.id, type: event.type, severity: event.severity,
      tsStart: event.tsStart,
    }).from(event)
      .where(and(
        eq(event.cameraId, id),
        gte(event.tsStart, from),
        lte(event.tsStart, to),
      ))
      .orderBy(asc(event.tsStart))
      .limit(500)

    // the app JWT type is fixed to the session payload; a media ticket is a
    // deliberately different shape, so it goes through an unknown cast
    const payload = { typ: 'archive', tenant_id: req.tenantId, cam: id } satisfies ArchiveTicket
    const ticket = app.jwt.sign(payload as unknown as Parameters<typeof app.jwt.sign>[0],
      { expiresIn: TICKET_TTL_SECONDS })
    return { segments, events, ticket, ttl: TICKET_TTL_SECONDS }
  })

  // Stream one segment with Range support. Auth is the media ticket in ?t=,
  // NOT the session token — verified here by hand.
  app.get('/archive/play/:id', {
    schema: { params: RangeParams, querystring: z.object({ t: z.string().min(1) }) },
  }, async (req, reply) => {
    let ticket: ArchiveTicket
    try {
      ticket = app.jwt.verify(req.query.t) as unknown as ArchiveTicket
    } catch {
      return reply.code(401).send({ message: 'bad or expired ticket' })
    }
    if (ticket.typ !== 'archive') {
      return reply.code(401).send({ message: 'wrong ticket type' })
    }

    const [seg] = await db.select({
      cameraId: archiveSegment.cameraId, filePath: archiveSegment.filePath,
    }).from(archiveSegment)
      .where(eq(archiveSegment.id, req.params.id)).limit(1)
    if (!seg || seg.cameraId !== ticket.cam) {
      return reply.code(404).send({ message: 'segment not found' })
    }

    // path safety: only serve files under ARCHIVE_ROOT (defense against a
    // tampered file_path ever reaching the DB)
    const root = path.resolve(config.ARCHIVE_ROOT)
    const file = path.resolve(seg.filePath)
    if (file !== root && !file.startsWith(root + path.sep)) {
      return reply.code(403).send({ message: 'path outside archive' })
    }

    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      // row exists but the file was rotated out by retention
      return reply.code(410).send({ message: 'segment file gone' })
    }

    reply.header('Accept-Ranges', 'bytes')
    reply.header('Content-Type', 'video/mp4')
    reply.header('Cache-Control', 'private, max-age=3600')

    const range = req.headers.range
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0
        const end = m[2] ? parseInt(m[2], 10) : size - 1
        if (start >= size || end >= size || start > end) {
          reply.header('Content-Range', `bytes */${size}`)
          return reply.code(416).send()
        }
        reply.code(206)
        reply.header('Content-Range', `bytes ${start}-${end}/${size}`)
        reply.header('Content-Length', String(end - start + 1))
        return reply.send(createReadStream(file, { start, end }))
      }
    }
    reply.header('Content-Length', String(size))
    return reply.send(createReadStream(file))
  })
}

export default archiveRoutes
