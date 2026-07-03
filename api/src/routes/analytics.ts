import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { event } from '../../db/schema.js'
import { SummaryQuery } from '../schemas.js'

interface SummaryRow {
  bucket: string
  type: string
  count: number
}

const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/analytics/summary', {
    preHandler: [app.authenticate],
    schema: { querystring: SummaryQuery },
  }, async (req) => {
    const q = req.query
    const res = await db.execute(sql`
      SELECT time_bucket('1 hour', ${event.tsStart}) AS bucket,
             ${event.type} AS type,
             count(*)::int AS count
      FROM ${event}
      WHERE ${event.tenantId} = ${req.tenantId}
        AND ${event.siteId} = ${q.site_id}
        AND ${event.tsStart} >= ${q.from}
        AND ${event.tsStart} <  ${q.to}
      GROUP BY bucket, type
      ORDER BY bucket ASC
    `)
    return { buckets: res.rows as unknown as SummaryRow[] }
  })
}

export default analyticsRoutes
