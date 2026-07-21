import { and, eq } from 'drizzle-orm'
import type Redis from 'ioredis'
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
    // default ON (anti-spam by owner's request): every frame-verifiable event
    // is checked before the alert goes out; fail-open keeps alerts alive when
    // Ollama is down. Set verify=false in the feature config to opt out.
    verify: cfg.verify === undefined ? true : Boolean(cfg.verify),
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
      think: false, // qwen3-vl reasons by default; we want the answer only
      options: { temperature: 0.2, num_predict: 160 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`ollama: HTTP ${res.status}`)
  const data = (await res.json()) as { response?: string }
  const text = (data.response ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // …and strip it if it leaks anyway
    .trim().replace(/\s+/g, ' ')
  return text ? text.slice(0, 800) : null
}

/** ДА / НЕТ verdict anywhere in the answer; null when the model didn't say. */
export function parseVerdict(answer: string | null): boolean | null {
  if (!answer) return null
  const m = /(^|[^а-яё])(да|нет)([^а-яё]|$)/i.exec(answer.toLowerCase())
  if (!m) return null
  return m[2] === 'да'
}

/** Redis key of the operator's false-positive counter for a camera+type pair. */
export const fpKey = (tenantId: string, cameraId: string, type: string): string =>
  `fp:${tenantId}:${cameraId}:${type}`

// ── observability ─────────────────────────────────────────────
// «VLM не работает» used to be invisible from the panel: the worker failed
// open and stayed silent. These counters + the Ollama probe below back the
// health line on /admin/features so the owner sees the real reason.

export const vlmStatsKey = (tenantId: string): string => `vlm:stats:${tenantId}`
export const VLM_WORKER_ALIVE_KEY = 'vlm:worker_alive'

export type VlmStat = 'described' | 'verified' | 'suppressed' | 'failed' | 'jobs'

/** Best-effort counter bump; stats must never break the alert path. */
export async function bumpVlmStat(
  redis: Redis, tenantId: string, stat: VlmStat, error?: string,
): Promise<void> {
  try {
    const key = vlmStatsKey(tenantId)
    await redis.hincrby(key, stat, 1)
    await redis.hset(key, `last_${stat}_ts`, String(Date.now()))
    if (error !== undefined) await redis.hset(key, 'last_error', error.slice(0, 300))
    await redis.expire(key, 14 * 24 * 3600)
  } catch {
    // ignore
  }
}

export interface OllamaHealth {
  ok: boolean
  models: string[]
  error: string | null
}

/** Probe Ollama: reachable at all, and which models are actually pulled. */
export async function ollamaHealth(timeoutMs = 5_000): Promise<OllamaHealth> {
  try {
    const res = await fetch(`${config.OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` }
    const data = (await res.json()) as { models?: { name?: string }[] }
    const models = (data.models ?? [])
      .map((m) => m.name ?? '')
      .filter((n): n is string => n.length > 0)
    return { ok: true, models, error: null }
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) }
  }
}
