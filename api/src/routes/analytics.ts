import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { event, camera, site, visitorDaily, zone } from '../../db/schema.js'
import { SummaryQuery } from '../schemas.js'

const DEFAULT_TZ = 'Europe/Moscow'

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

    // same totals for the previous window of equal length → trend deltas
    const spanMs = new Date(q.to).getTime() - new Date(q.from).getTime()
    const prevFrom = new Date(new Date(q.from).getTime() - spanMs).toISOString()
    const prevTotals = await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${event.severity} = 'critical')::int AS critical
      FROM ${event}
      WHERE ${event.tenantId} = ${req.tenantId}
        AND ${event.tsStart} >= ${prevFrom} AND ${event.tsStart} < ${q.from}
        ${siteCond}
    `)

    // service metrics («язык денег»): dwell_sec recorded on zone_exit
    const dwell = await db.execute(sql`
      SELECT z.kind AS kind,
             round(avg((e.meta->>'dwell_sec')::float))::int AS avg_sec,
             round(max((e.meta->>'dwell_sec')::float))::int AS max_sec,
             count(*)::int AS visits
      FROM ${event} e JOIN ${zone} z ON z.id = e.zone_id
      WHERE e.tenant_id = ${req.tenantId}
        AND e.type = 'zone_exit'
        AND e.meta ? 'dwell_sec'
        AND e.ts_start >= ${q.from} AND e.ts_start < ${q.to}
        ${q.site_id ? sql`AND e.site_id = ${q.site_id}` : sql``}
      GROUP BY z.kind ORDER BY visits DESC
    `)

    // peak load: events per (iso weekday, hour) in the site's timezone
    let tz = DEFAULT_TZ
    if (q.site_id) {
      const [s] = await db.select({ timezone: site.timezone }).from(site)
        .where(sql`${site.id} = ${q.site_id} AND ${site.tenantId} = ${req.tenantId}`).limit(1)
      if (s?.timezone) tz = s.timezone
    }
    const peak = await db.execute(sql`
      SELECT extract(isodow FROM ${event.tsStart} AT TIME ZONE ${tz})::int AS dow,
             extract(hour FROM ${event.tsStart} AT TIME ZONE ${tz})::int AS hour,
             count(*)::int AS count
      FROM ${event}
      WHERE ${event.tenantId} = ${req.tenantId}
        AND ${event.tsStart} >= ${q.from} AND ${event.tsStart} < ${q.to}
        ${siteCond}
      GROUP BY dow, hour
    `)

    // visitor history (visitor_daily fills up from the day this ships)
    const visitors = await db.execute(sql`
      SELECT v.day::text AS day, sum(v.visitors)::int AS visitors
      FROM ${visitorDaily} v JOIN ${site} s ON s.id = v.site_id
      WHERE s.tenant_id = ${req.tenantId}
        AND v.day >= ${q.from}::date AND v.day <= ${q.to}::date
        ${q.site_id ? sql`AND v.site_id = ${q.site_id}` : sql``}
      GROUP BY v.day ORDER BY v.day ASC
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
      prevTotals: (prevTotals.rows[0] ?? { total: 0, critical: 0 }) as unknown as {
        total: number; critical: number
      },
      dwell: dwell.rows as unknown as {
        kind: string; avg_sec: number; max_sec: number; visits: number
      }[],
      peak: peak.rows as unknown as { dow: number; hour: number; count: number }[],
      visitorsByDay: visitors.rows as unknown as { day: string; visitors: number }[],
      tz,
    }
  })
}

export default analyticsRoutes
