import { and, eq } from 'drizzle-orm'
import { db } from './db/client.js'
import { tenantFeature } from '../db/schema.js'
import { config } from './config.js'
import { minio } from './minio.js'

// Shared local-VLM plumbing: per-tenant settings (feature `vlm`), snapshot
// loading and Ollama vision calls. Used by the ai worker (descriptions,
// pre-alert verification) and the per-event "ask AI" route.

export const VLM_TIMEOUT_MS = 40_000

export interface VlmSettings {
  enabled: boolean
  model: string
  minSeverity: 'info' | 'warn' | 'critical'
  verify: boolean          // force pre-alert verification for verifiable types
  autoVerifyAfter: number  // …or enable it per camera+type after N false positives
}

export async function vlmSettings(tenantId: string): Promise<VlmSettings> {
  const [row] = await db.select({
    enabled: tenantFeature.enabled, config: tenantFeature.config,
  }).from(tenantFeature)
    .where(and(eq(tenantFeature.tenantId, tenantId), eq(tenantFeature.feature, 'vlm')))
    .limit(1)
  const cfg = (row?.config ?? {}) as Record<string, unknown>
  const sev = cfg.min_severity
  const after = Number(cfg.auto_verify_after)
  return {
    enabled: Boolean(row?.enabled),
    model: typeof cfg.model === 'string' && cfg.model ? cfg.model : config.VLM_MODEL,
    minSeverity: sev === 'info' || sev === 'warn' || sev === 'critical' ? sev : 'warn',
    verify: Boolean(cfg.verify),
    autoVerifyAfter: Number.isFinite(after) && after > 0 ? after : 3,
  }
}

export async function snapshotB64(snapshotKey: string): Promise<string> {
  const stream = await minio.getObject(config.MINIO_BUCKET_SNAPSHOTS, snapshotKey)
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('base64')
}

/** One vision call; trimmed single-paragraph answer or null when empty. */
export async function ollamaVision(
  model: string, imageB64: string, prompt: string, timeoutMs = VLM_TIMEOUT_MS,
): Promise<string | null> {
  const res = await fetch(`${config.OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      images: [imageB64],
      stream: false,
      options: { temperature: 0.2, num_predict: 160 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`ollama: HTTP ${res.status}`)
  const data = (await res.json()) as { response?: string }
  const text = (data.response ?? '').trim().replace(/\s+/g, ' ')
  return text ? text.slice(0, 800) : null
}

/** Redis key of the operator's false-positive counter for a camera+type pair. */
export const fpKey = (tenantId: string, cameraId: string, type: string): string =>
  `fp:${tenantId}:${cameraId}:${type}`
