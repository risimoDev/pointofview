import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { event, camera } from '../../db/schema.js'
import { SummaryQuery } from '../schemas.js'

interface SummaryRow {
  bucket: string
  type: string
  count: number
}

const OverviewQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  site_id: z.string().uuid().optional(),
  // bucket size adapts to the picked range (day → hours, month → days)
  bucket: z.enum(['hour', 'day']).default('hour'),
})

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

  // Everything the /analytics page needs in one round-trip.
  app.get('/analytics/overview', {
    preHandler: [app.authenticate],
    schema: { querystring: OverviewQuery },
  }, async (req) => {
    const q = req.query
    const interval = q.bucket === 'day' ? '1 day' : '1 hour'
    const siteCond = q.site_id ? sql`AND ${event.siteId} = ${q.site_id}` : sql``

    const series = await db.execute(sql`
      SELECT time_bucket(${interval}::interval, ${event.tsStart}) AS bucket,
             ${event.type} AS type,
             count(*)::int AS count
      FROM ${event}
      WHERE ${event.tenantId} = ${req.tenantId}
        AND ${event.tsStart} >= ${q.from} AND ${event.tsStart} < ${q.to}
        ${siteCond}
      GROUP BY bucket, type
      ORDER BY bucket ASC
    `)

    const byType = await db.execute(sql`
      SELECT ${event.type} AS type,
             count(*)::int AS count,
             count(*) FILTER (WHERE ${event.severity} = 'critical')::int AS critical
      FROM ${event}
      WHERE ${event.tenantId} = ${req.tenantId}
        AND ${event.tsStart} >= ${q.from} AND ${event.tsStart} < ${q.to}
        ${siteCond}
      GROUP BY type ORDER BY count DESC
    `)

    const byCamera = await db.execute(sql`
      SELECT e.camera_id AS camera_id,
             coalesce(c.name, left(e.camera_id::text, 8)) AS camera_name,
             count(*)::int AS count
      FROM ${event} e LEFT JOIN ${camera} c ON c.id = e.camera_id
      WHERE e.tenant_id = ${req.tenantId}
        AND e.ts_start >= ${q.from} AND e.ts_start < ${q.to}
        ${q.site_id ? sql`AND e.site_id = ${q.site_id}` : sql``}
      GROUP BY e.camera_id, c.name ORDER BY count DESC LIMIT 10
    `)

    const totals = await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${event.severity} = 'critical')::int AS critical,
             count(*) FILTER (WHERE NOT ${event.resolved})::int AS unresolved
      FROM ${event}
      WHERE ${event.tenantId} = ${req.tenantId}
        AND ${event.tsStart} >= ${q.from} AND ${event.tsStart} < ${q.to}
        ${siteCond}
    `)

    return {
      series: series.rows as unknown as SummaryRow[],
      byType: byType.rows as unknown as { type: string; count: number; critical: number }[],
      byCamera: byCamera.rows as unknown as {
        camera_id: string; camera_name: string; count: number
      }[],
      totals: (totals.rows[0] ?? { total: 0, critical: 0, unresolved: 0 }) as unknown as {
        total: number; critical: number; unresolved: number
      },
    }
  })
}

export default analyticsRoutes
