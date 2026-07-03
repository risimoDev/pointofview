import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { db } from '../db/client.js'
import { archiveSegment } from '../../db/schema.js'
import { config } from '../config.js'
import { SegmentBody } from '../schemas.js'

/**
 * Service-to-service endpoints (recorder.py → here). Guarded by a shared
 * INTERNAL_TOKEN header, not JWT. Mounted without the /api/v1 prefix.
 */
const internalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (req.headers['x-internal-token'] !== config.INTERNAL_TOKEN) {
      return reply.code(401).send({ message: 'unauthorized' })
    }
  })

  app.post('/segments', {
    schema: { body: SegmentBody },
  }, async (req, reply) => {
    const b = req.body
    const [row] = await db.insert(archiveSegment).values({
      cameraId: b.camera_id,
      startedAt: new Date(b.started_at),
      endedAt: b.ended_at ? new Date(b.ended_at) : null,
      filePath: b.file_path,
      sizeBytes: b.size_bytes ?? null,
    }).returning({ id: archiveSegment.id })
    return reply.code(201).send(row)
  })
}

export default internalRoutes
