import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { db } from '../db/client.js'
import { archiveSegment } from '../../db/schema.js'
import { config } from '../config.js'
import { SegmentBody } from '../schemas.js'
import { ensureBucket, minio } from '../minio.js'

const ReidCropBody = z.object({
  tenant_id: z.string().uuid(),
  site_id: z.string().uuid(),
  gid: z.string().min(1).max(64),
  jpeg_b64: z.string().min(1).max(2_000_000), // ~1.5MB decoded cap
})

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

  // analyzer → identity crop for the «Люди» page (first sighting of a person)
  app.post('/reid/crop', {
    schema: { body: ReidCropBody },
  }, async (req, reply) => {
    const b = req.body
    const key = `reid/${b.tenant_id}/${b.gid}.jpg`
    const buf = Buffer.from(b.jpeg_b64, 'base64')
    await ensureBucket(config.MINIO_BUCKET_SNAPSHOTS)
    await minio.putObject(config.MINIO_BUCKET_SNAPSHOTS, key, buf, buf.length, {
      'Content-Type': 'image/jpeg',
    })
    return reply.code(201).send({ stored: key })
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
