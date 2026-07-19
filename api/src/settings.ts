import { eq } from 'drizzle-orm'
import { db } from './db/client.js'
import { systemSetting } from '../db/schema.js'
import { config } from './config.js'

/**
 * Server-wide settings editable from /admin/settings. A DB row overrides the
 * env default; deleting the row falls back to env. Read through a short cache
 * so hot paths (watchdog tick, alert dispatch) don't hit PostgreSQL each time.
 */

export interface SettingDef {
  key: string
  group: 'cameras' | 'archive' | 'events' | 'clips' | 'alerts'
  type: 'number' | 'boolean' | 'secret' | 'text'
  label: string
  hint?: string
  min?: number
  max?: number
  def: number | boolean | string
}

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'camera_offline_alert_seconds', group: 'cameras', type: 'number',
    label: 'Порог алерта «камера не в сети», сек', min: 60, max: 86_400,
    hint: 'Сколько камера должна молчать, прежде чем создастся событие camera_offline',
    def: config.CAMERA_OFFLINE_ALERT_SECONDS,
  },
  {
    key: 'archive_retention_days', group: 'archive', type: 'number',
    label: 'Хранить архив, дней', min: 1, max: 365,
    hint: 'Сегменты старше удаляются автоматически (проверка раз в час)',
    def: 7,
  },
  {
    key: 'archive_min_free_gb', group: 'archive', type: 'number',
    label: 'Минимум свободного места, ГБ', min: 1, max: 10_000,
    hint: 'Если на диске архива меньше — удаляются самые старые записи, даже свежее срока',
    def: 20,
  },
  {
    key: 'event_retention_days', group: 'events', type: 'number',
    label: 'Хранить события, дней', min: 7, max: 3650,
    hint: 'События старше удаляются из БД (по чанкам TimescaleDB)',
    def: 90,
  },
  {
    key: 'clip_pre_roll_sec', group: 'clips', type: 'number',
    label: 'Клип: секунд до события', min: 0, max: 120,
    def: config.CLIP_PRE_ROLL_SEC,
  },
  {
    key: 'clip_post_roll_sec', group: 'clips', type: 'number',
    label: 'Клип: секунд после события', min: 0, max: 300,
    def: config.CLIP_POST_ROLL_SEC,
  },
  {
    key: 'clip_watermark', group: 'clips', type: 'boolean',
    label: 'Водяной знак на клипах',
    def: config.CLIP_WATERMARK,
  },
  {
    key: 'alert_digest_minutes', group: 'alerts', type: 'number',
    label: 'Интервал сводки алертов, мин', min: 5, max: 240,
    hint: 'Некритичные события копятся и приходят одним сообщением раз в этот интервал; critical — сразу',
    def: 30,
  },
  {
    key: 'telegram_bot_token', group: 'alerts', type: 'secret',
    label: 'Telegram bot token',
    hint: 'Пусто — используется токен из .env на сервере',
    def: '',
  },
  {
    key: 'lead_telegram_chat_id', group: 'alerts', type: 'text',
    label: 'Telegram chat_id для заявок с сайта',
    hint: 'Сюда бот присылает заявки «Запросить демо» с публичной страницы. Пусто — форма отключена',
    def: '',
  },
  {
    key: 'report_telegram_chat_id', group: 'alerts', type: 'text',
    label: 'Telegram chat_id для отчётов',
    hint: 'Сюда бот отправляет PDF-отчёты по охране труда (кнопка «В Telegram» на странице «Отчёты»)',
    def: '',
  },
]

const defByKey = new Map(SETTING_DEFS.map((d) => [d.key, d]))

const CACHE_MS = 30_000
let cache: Record<string, unknown> = {}
let cacheAt = 0

export async function loadSettings(force = false): Promise<Record<string, unknown>> {
  if (!force && Date.now() - cacheAt < CACHE_MS) return cache
  const rows = await db.select().from(systemSetting)
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  cacheAt = Date.now()
  return cache
}

export async function settingNumber(key: string): Promise<number> {
  const def = defByKey.get(key)
  if (!def || def.type !== 'number') throw new Error(`unknown number setting: ${key}`)
  const v = (await loadSettings())[key]
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && v !== undefined && v !== null ? n : (def.def as number)
}

export async function settingBool(key: string): Promise<boolean> {
  const def = defByKey.get(key)
  if (!def || def.type !== 'boolean') throw new Error(`unknown boolean setting: ${key}`)
  const v = (await loadSettings())[key]
  return typeof v === 'boolean' ? v : (def.def as boolean)
}

export async function settingSecret(key: string): Promise<string> {
  const def = defByKey.get(key)
  if (!def || def.type !== 'secret') throw new Error(`unknown secret setting: ${key}`)
  const v = (await loadSettings())[key]
  return typeof v === 'string' ? v : ''
}

export async function settingText(key: string): Promise<string> {
  const def = defByKey.get(key)
  if (!def || def.type !== 'text') throw new Error(`unknown text setting: ${key}`)
  const v = (await loadSettings())[key]
  return typeof v === 'string' ? v : (def.def as string)
}

/** Validate + upsert one setting; empty secret deletes the row (env fallback). */
export async function saveSetting(key: string, value: unknown): Promise<void> {
  const def = defByKey.get(key)
  if (!def) throw new Error(`unknown setting: ${key}`)

  if (def.type === 'number') {
    const n = Number(value)
    if (!Number.isFinite(n)) throw new Error(`${key}: not a number`)
    if (def.min !== undefined && n < def.min) throw new Error(`${key}: min ${def.min}`)
    if (def.max !== undefined && n > def.max) throw new Error(`${key}: max ${def.max}`)
    value = n
  } else if (def.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${key}: not a boolean`)
  } else { // secret | text
    if (typeof value !== 'string') throw new Error(`${key}: not a string`)
    if (value.length > 4096) throw new Error(`${key}: too long`)
    value = value.trim()
    if (value === '') {
      await db.delete(systemSetting).where(eq(systemSetting.key, key))
      cacheAt = 0
      return
    }
  }

  await db.insert(systemSetting)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSetting.key, set: { value, updatedAt: new Date() } })
  cacheAt = 0
}
