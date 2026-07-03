import { db } from './db/client.js'
import { auditLog } from '../db/schema.js'

/** Append an audit entry. Never throws — auditing must not break a request. */
export async function writeAudit(entry: {
  tenantId: string
  userId?: string | null
  action: string
  resourceType?: string | null
  resourceId?: string | null
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      tenantId: entry.tenantId,
      userId: entry.userId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      details: entry.details ?? {},
    })
  } catch {
    /* swallow: audit is best-effort */
  }
}
