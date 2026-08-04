import type IORedis from 'ioredis'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { db } from './db/client.js'
import { event } from '../db/schema.js'
import { config } from './config.js'
import { minio } from './minio.js'
import { writeAudit } from './audit.js'
import { fpKey } from './vlm.js'

/** Who performed the action. A Telegram acknowledgement has no platform user,
 *  so `userId` stays null and the person is recorded in meta instead — the
 *  column is a FK to `user` and inventing an id there would corrupt it. */
export interface Actor {
  tenantId: string
  userId: string | null
  /** 'ui' | 'telegram' — kept in event.meta so the journal shows the channel */
  via: string
  /** display name for a non-platform actor (Telegram first name / username) */
  name?: string | null
}

/** `meta || patch` rather than an assignment: the pipeline already wrote
 *  ai_description, global_id and model_version there, and a plain set would
 *  drop them. */
function mergeMeta(actor: Actor): SQL {
  const patch: Record<string, unknown> = actor.userId
    ? { ack_via: actor.via }
    : { ack_via: actor.via, ack_by: actor.name ?? null }
  return sql`${event.meta} || ${JSON.stringify(patch)}::jsonb`
}

/** Mark handled. Returns null when the event does not exist for this tenant. */
export async function resolveEvent(
  eventId: string, actor: Actor,
): Promise<{ id: string; type: string } | null> {
  const [row] = await db.update(event)
    .set({
      resolved: true,
      resolvedBy: actor.userId,
      resolvedAt: new Date(),
      meta: mergeMeta(actor),
    })
    .where(and(eq(event.id, eventId), eq(event.tenantId, actor.tenantId)))
    .returning({ id: event.id, type: event.type })
  if (!row) return null
  await writeAudit({
    tenantId: actor.tenantId, userId: actor.userId, action: 'event.resolve',
    resourceType: 'event', resourceId: row.id,
    details: { type: row.type, via: actor.via, by: actor.name ?? null },
  })
  return row
}

/** Operator feedback: the alert was false (or undo).
 *
 *  Three side effects belong together and must not drift apart: the event is
 *  excluded from safety reports, the camera+type counter that arms the VLM
 *  verification gate moves, and the frame is copied into the fine-tuning
 *  dataset. Both the UI route and the Telegram button call this. */
export async function markFalsePositive(
  eventId: string, actor: Actor, on: boolean, redis: IORedis,
): Promise<{ id: string; falsePositive: boolean; type: string } | null> {
  const [row] = await db.update(event)
    .set(on
      ? {
          falsePositive: true, resolved: true,
          resolvedBy: actor.userId, resolvedAt: new Date(),
          meta: mergeMeta(actor),
        }
      : { falsePositive: false })
    .where(and(eq(event.id, eventId), eq(event.tenantId, actor.tenantId)))
    .returning({
      id: event.id, cameraId: event.cameraId, type: event.type,
      snapshotKey: event.snapshotKey, falsePositive: event.falsePositive,
    })
  if (!row) return null

  const key = fpKey(actor.tenantId, row.cameraId, row.type)
  if (on) {
    await redis.incr(key)
    await redis.expire(key, 30 * 86_400)
    if (row.snapshotKey) {
      await minio.copyObject(
        config.MINIO_BUCKET_SNAPSHOTS,
        `fp/${actor.tenantId}/${row.type}/${row.id}.jpg`,
        `/${config.MINIO_BUCKET_SNAPSHOTS}/${row.snapshotKey}`,
      ).catch(() => undefined)
    }
  } else {
    await redis.decr(key) // read side clamps negatives to 0
  }
  await writeAudit({
    tenantId: actor.tenantId, userId: actor.userId,
    action: on ? 'event.false_positive' : 'event.false_positive_undo',
    resourceType: 'event', resourceId: row.id,
    details: { type: row.type, via: actor.via, by: actor.name ?? null },
  })
  return { id: row.id, falsePositive: row.falsePositive, type: row.type }
}
