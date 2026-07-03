import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm'
import { db } from '../db/client.js'
import { event } from '../../db/schema.js'
import { EventIdParams, EventsQuery } from '../schemas.js'
import { clipsQueue } from '../queues.js'
import { CLIPS_BUCKET, minioPublic } from '../minio.js'

const eventsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/events', {
    preHandler: [app.authenticate],
    schema: { querystring: EventsQuery },
  }, async (req) => {
    const q = req.query
    const conds: SQL[] = [eq(event.tenantId, req.tenantId)]
    if (q.camera_id) conds.push(eq(event.cameraId, q.camera_id))
    if (q.type) conds.push(eq(event.type, q.type))
    if (q.severity) conds.push(eq(event.severity, q.severity))
    if (q.from) conds.push(gte(event.tsStart, new Date(q.from)))
    if (q.to) conds.push(lt(event.tsStart, new Date(q.to)))
    if (q.cursor) conds.push(lt(event.tsStart, new Date(q.cursor))) // keyset

    const rows = await db.select().from(event)
      .where(and(...conds))
      .orderBy(desc(event.tsStart))
      .limit(q.limit)

    const last = rows.at(-1)
    const nextCursor = rows.length === q.limit && last ? last.tsStart.toISOString() : null
    return { items: rows, nextCursor }
  })

  // Enqueue clip cut for an event
  app.post('/events/:id/clip', {
    preHandler: [app.authenticate],
    schema: { params: EventIdParams },
  }, async (req, reply) => {
    const [ev] = await db.select({
      id: event.id, cameraId: event.cameraId,
      tsStart: event.tsStart, tsEnd: event.tsEnd,
    }).from(event)
      .where(and(eq(event.id, req.params.id), eq(event.tenantId, req.tenantId)))
      .limit(1)
    if (!ev) return reply.code(404).send({ message: 'event not found' })

    const job = await clipsQueue.add('cut', {
      event_id: ev.id,
      camera_id: ev.cameraId,
      ts_start: ev.tsStart.toISOString(),
      ts_end: (ev.tsEnd ?? ev.tsStart).toISOString(),
      tenant_id: req.tenantId,
    }, { removeOnComplete: 100, removeOnFail: 500, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })

    return reply.code(202).send({ jobId: job.id })
  })

  // Presigned URL for a ready clip (1h TTL)
  app.get('/events/:id/clip', {
    preHandler: [app.authenticate],
    schema: { params: EventIdParams },
  }, async (req, reply) => {
    const [ev] = await db.select({ clipKey: event.clipKey }).from(event)
      .where(and(eq(event.id, req.params.id), eq(event.tenantId, req.tenantId)))
      .limit(1)
    if (!ev) return reply.code(404).send({ message: 'event not found' })
    if (!ev.clipKey) return reply.code(409).send({ message: 'clip not ready' })

    const url = await minioPublic.presignedGetObject(CLIPS_BUCKET, ev.clipKey, 3600)
    return { url }
  })

  // Short-lived single-use ticket for the WS handshake (keeps JWT out of URLs)
  app.get('/ws-ticket', {
    preHandler: [app.authenticate],
  }, async (req) => {
    const ticket = randomUUID()
    await app.redis.set(`ws_ticket:${ticket}`, req.tenantId, 'EX', 30)
    return { ticket }
  })
}

export default eventsRoutes
