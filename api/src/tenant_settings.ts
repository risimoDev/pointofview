import { eq } from 'drizzle-orm'
import { db } from './db/client.js'
import { tenant } from '../db/schema.js'

/**
 * Per-organisation settings kept in `tenant.settings` (jsonb).
 *
 * Distinct from src/settings.ts on purpose: that table is server-wide. Anything
 * that names a recipient or changes what one organisation receives must live
 * here, or a second tenant starts getting the first one's notifications.
 *
 * Read through a short cache — the alert path touches this per event.
 */

export interface TenantSettings {
  /** Telegram chat for unacknowledged critical events. Empty = no escalation. */
  escalation_chat_id: string
  /** null = fall back to the server-wide `escalation_minutes`. */
  escalation_minutes: number | null
  /** ISO timestamp; while in the future, no notifications leave the system. */
  learning_until: string | null
}

export const EMPTY_TENANT_SETTINGS: TenantSettings = {
  escalation_chat_id: '',
  escalation_minutes: null,
  learning_until: null,
}

function parse(raw: Record<string, unknown> | null | undefined): TenantSettings {
  const s = raw ?? {}
  return {
    escalation_chat_id: typeof s.escalation_chat_id === 'string' ? s.escalation_chat_id : '',
    escalation_minutes: typeof s.escalation_minutes === 'number' ? s.escalation_minutes : null,
    learning_until: typeof s.learning_until === 'string' ? s.learning_until : null,
  }
}

const CACHE_MS = 30_000
const cache = new Map<string, { at: number; value: TenantSettings }>()

export async function getTenantSettings(tenantId: string): Promise<TenantSettings> {
  const hit = cache.get(tenantId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const [row] = await db.select({ settings: tenant.settings })
    .from(tenant).where(eq(tenant.id, tenantId)).limit(1)
  const value = parse(row?.settings)
  cache.set(tenantId, { at: Date.now(), value })
  return value
}

/** Merge a patch into the stored jsonb. Unknown keys already there survive. */
export async function saveTenantSettings(
  tenantId: string, patch: Partial<TenantSettings>,
): Promise<void> {
  const [row] = await db.select({ settings: tenant.settings })
    .from(tenant).where(eq(tenant.id, tenantId)).limit(1)
  await db.update(tenant)
    .set({ settings: { ...(row?.settings ?? {}), ...patch } })
    .where(eq(tenant.id, tenantId))
  cache.delete(tenantId)
}

/** Every tenant, for the sweeps that run on a timer rather than per request. */
export async function allTenantSettings(): Promise<Array<{ id: string; settings: TenantSettings }>> {
  const rows = await db.select({ id: tenant.id, settings: tenant.settings }).from(tenant)
  return rows.map((r) => ({ id: r.id, settings: parse(r.settings) }))
}

/** True while the organisation is still in its post-installation quiet period.
 *
 *  The first days after installation produce the worst signal-to-noise of the
 *  whole deployment: zones are not tuned, thresholds are defaults, and the
 *  resulting flood is the single most common reason a site switches the
 *  notifications off entirely and never switches them back on. Events are
 *  still recorded — that is what the tuning is done from. */
export function inLearningMode(s: TenantSettings, now = new Date()): boolean {
  if (!s.learning_until) return false
  const until = Date.parse(s.learning_until)
  return Number.isFinite(until) && until > now.getTime()
}
