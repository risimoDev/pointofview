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

// Why /api/chat and not /api/generate: on the generate endpoint Ollama drops
// `think: false` (ollama#14793), and the qwen3-vl templates carry no
// thinking-control logic at all (ollama#14798, #12906). The model then spends
// the whole num_predict budget reasoning and `response` comes back EMPTY —
// the "VLM отвечает пустотой" symptom from прод. On /api/chat the top-level
// `think` flag is honoured, reasoning (when it still happens) is separated
// into message.thinking, and the budget below leaves room for an answer even
// if a future template ignores the flag again.

const NUM_PREDICT_ANSWER = 512  // descriptions / free-form answers
const NUM_PREDICT_VERDICT = 256 // ДА/НЕТ — short, but must survive a stray preamble

// Qwen3's own soft switch, baked in during post-training and handled by the
// model rather than by the Ollama template. Since the qwen3-vl template
// carries no thinking-control logic at all, the API-level `think: false` has
// nothing to act on — but this still does. Harmless for models that never
// reason: it is just trailing text they ignore.
const NO_THINK = ' /no_think'

interface OllamaChatResponse {
  message?: { content?: string; thinking?: string }
  done_reason?: string
  error?: string
}

const clean = (s: string): string =>
  s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/\s+/g, ' ')

/**
 * One Ollama chat call. Returns the answer, or throws with a diagnosable
 * reason — callers fail open and record it via bumpVlmStat, so the panel
 * shows WHY instead of going quiet.
 */
async function ollamaChat(
  model: string, prompt: string, images: string[] | undefined,
  timeoutMs: number, numPredict: number, salvageOnLength = false,
  format?: unknown,
): Promise<string | null> {
  const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: prompt + NO_THINK,
        ...(images ? { images } : {}),
      }],
      stream: false,
      think: false, // top-level: honoured here, silently dropped by /api/generate
      // JSON schema: the model is constrained to emit valid JSON instead of
      // prose we then parse. Regex over Russian sentences is what made the
      // verdict unreliable twice already.
      ...(format ? { format } : {}),
      options: { temperature: 0.2, num_predict: numPredict },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`ollama: HTTP ${res.status}`)

  const data = (await res.json()) as OllamaChatResponse
  if (data.error) throw new Error(`ollama: ${data.error}`)

  const content = clean(data.message?.content ?? '')
  if (content) return content.slice(0, 800)

  // Template ignored `think: false`: the answer, if any, is inside the
  // reasoning. Salvage it rather than reporting a failure — for a ДА/НЕТ
  // verdict the reasoning almost always contains the verdict.
  const thinking = clean(data.message?.thinking ?? '')
  if (thinking) {
    // A liveness probe only needs proof the model ran: truncated reasoning is
    // still an answer. For descriptions and verdicts it is not — half a
    // thought would land in a Telegram alert or decide an alert's fate.
    if (data.done_reason === 'length' && !salvageOnLength) {
      throw new Error(
        `модель ${model} ушла в размышление и не уложилась в ${numPredict} токенов. ` +
        'Шаблон игнорирует и think=false, и /no_think. Попробуйте обновить образ ' +
        `(ollama pull ${model}); если не поможет — смените модель в настройках ` +
        'функции на нерассуждающую, например qwen2.5vl:3b',
      )
    }
    return thinking.slice(0, 800)
  }

  throw new Error(
    `пустой ответ модели ${model} (done_reason=${data.done_reason ?? 'нет'}); ` +
    'проверьте, что модель скачана и поддерживает изображения',
  )
}

/** One vision call; trimmed single-paragraph answer. */
export async function ollamaVision(
  model: string, imageB64: string, prompt: string, timeoutMs = VLM_TIMEOUT_MS,
  numPredict = NUM_PREDICT_ANSWER,
): Promise<string | null> {
  return ollamaChat(model, prompt, [imageB64], timeoutMs, numPredict)
}

/** Vision call for a ДА/НЕТ verdict — smaller budget, same plumbing. */
export interface Verdict {
  /** true = event confirmed by the frame, false = not, null = no answer */
  confirmed: boolean | null
  reason: string
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['confirmed', 'reason'],
} as const

/**
 * Structured verdict. The model is constrained to a JSON schema, so the answer
 * is read, not guessed: no more hunting for «да»/«нет» inside a sentence that
 * may open with "На кадре…" or arrive wrapped in reasoning. Falls back to the
 * old text parsing only if the model returns something unparseable, which
 * keeps the fail-open behaviour rather than dropping an alert.
 */
export async function ollamaVerdict(
  model: string, imageB64: string, prompt: string, timeoutMs = VLM_TIMEOUT_MS,
): Promise<Verdict> {
  const raw = await ollamaChat(
    model, prompt, [imageB64], timeoutMs, NUM_PREDICT_VERDICT, false,
    VERDICT_SCHEMA,
  )
  if (!raw) return { confirmed: null, reason: '' }
  try {
    const parsed = JSON.parse(raw) as { confirmed?: unknown; reason?: unknown }
    if (typeof parsed.confirmed === 'boolean') {
      return {
        confirmed: parsed.confirmed,
        reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '',
      }
    }
  } catch {
    // not JSON — fall through to the legacy text reading
  }
  return { confirmed: parseVerdict(raw), reason: raw.slice(0, 300) }
}

/**
 * Text-only generation — the panel's «проверить ИИ» probe.
 *
 * 256 tokens, not 64: the qwen3-vl template ignores `think: false`, so even a
 * one-word answer pays for a paragraph of reasoning first. A probe that fails
 * on its own budget reports the model as broken while it is perfectly healthy.
 */
export async function ollamaText(
  model: string, prompt: string, timeoutMs = VLM_TIMEOUT_MS,
): Promise<string | null> {
  const text = await ollamaChat(model, prompt, undefined, timeoutMs, 256, true)
  return text ? text.slice(0, 200) : null
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

export type VlmStat =
  | 'described' | 'verified' | 'suppressed' | 'failed' | 'jobs'
  // verification could not be trusted: frame too old / queue backlog
  | 'stale' | 'skipped'

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
