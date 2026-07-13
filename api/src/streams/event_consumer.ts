import type { FastifyBaseLogger } from 'fastify'
import type Redis from 'ioredis'
import { db } from '../db/client.js'
import { event } from '../../db/schema.js'
import { config } from '../config.js'
import { EventMessageSchema, type EventMessage } from '../schemas.js'
import { alertsQueue } from '../queues.js'

const BLOCK_MS = 5000
const BATCH = 20

// entries/exits are statistics, not alarms — they persist and hit the WS feed
// but never spawn alert jobs (this alone was most of the 5k-a-day flood)
const NO_ALERT_TYPES = new Set(['zone_entry', 'zone_exit'])

/**
 * Redis Streams consumer group on `events`.
 * XREADGROUP → insert into PostgreSQL → XACK. Bad/failed messages are
 * dead-lettered to `events:failed` and ACKed so they don't block the group.
 * After a successful insert the event is PUBLISHed to `events:{tenant_id}`
 * so the WebSocket hub can fan it out to browsers.
 */
export class EventConsumer {
  private running = false

  constructor(
    private readonly redis: Redis,
    private readonly pub: Redis,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    await this.ensureGroup()
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        'CREATE', config.EVENTS_STREAM, config.CONSUMER_GROUP, '$', 'MKSTREAM',
      )
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const res = await this.redis.xreadgroup(
          'GROUP', config.CONSUMER_GROUP, config.CONSUMER_NAME,
          'COUNT', BATCH, 'BLOCK', BLOCK_MS,
          'STREAMS', config.EVENTS_STREAM, '>',
        )
        if (!res) continue
        // res: [[stream, [[id, [field, value, ...]], ...]]]
        for (const [, entries] of res as [string, [string, string[]][]][]) {
          for (const [id, fields] of entries) {
            await this.handle(id, fields)
          }
        }
      } catch (err) {
        this.log.error({ err }, 'event consumer loop error')
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }

  private async handle(id: string, fields: string[]): Promise<void> {
    const raw = fieldValue(fields, 'data')
    try {
      const msg = EventMessageSchema.parse(JSON.parse(raw ?? '{}'))
      const eventId = await this.insert(msg)
      await this.pub.publish(`events:${msg.tenant_id}`, raw ?? '')
      if (!NO_ALERT_TYPES.has(msg.type)) {
        await alertsQueue.add('notify', { event_id: eventId, tenant_id: msg.tenant_id }, {
          removeOnComplete: 200, removeOnFail: 500, attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
        })
      }
      await this.redis.xack(config.EVENTS_STREAM, config.CONSUMER_GROUP, id)
    } catch (err) {
      this.log.warn({ err, id }, 'event insert failed → dead letter')
      await this.redis.xadd(
        config.FAILED_STREAM, '*',
        'data', raw ?? '',
        'error', err instanceof Error ? err.message : String(err),
      )
      await this.redis.xack(config.EVENTS_STREAM, config.CONSUMER_GROUP, id)
    }
  }

  private async insert(m: EventMessage): Promise<string> {
    const [row] = await db.insert(event).values({
      tenantId: m.tenant_id,
      siteId: m.site_id,
      cameraId: m.camera_id,
      zoneId: m.zone_id ?? null,
      type: m.type,
      severity: m.severity,
      trackId: m.track_id ?? null,
      tsStart: new Date(m.ts_start),
      tsEnd: m.ts_end ? new Date(m.ts_end) : null,
      confidence: m.confidence ?? null,
      bbox: m.bbox ?? null,
      meta: m.meta ?? {},
    }).returning({ id: event.id })
    return row!.id
  }
}

function fieldValue(fields: string[], key: string): string | undefined {
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === key) return fields[i + 1]
  }
  return undefined
}
