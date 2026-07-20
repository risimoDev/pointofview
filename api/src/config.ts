import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(8),
  GO2RTC_URL: z.string().default('http://localhost:1984'),
  // local VLM (Ollama) for event scene descriptions; model is overridable
  // per-tenant in the `vlm` feature config
  OLLAMA_URL: z.string().default('http://ollama:11434'),
  VLM_MODEL: z.string().default('qwen3-vl:4b'),

  EVENTS_STREAM: z.string().default('events'),
  FAILED_STREAM: z.string().default('events:failed'),
  CONSUMER_GROUP: z.string().default('api-consumers'),
  CONSUMER_NAME: z.string().default('api-1'),

  // MinIO
  MINIO_ENDPOINT: z.string().default('http://localhost:9000'),
  // browser-reachable endpoint for presigned URLs; falls back to MINIO_ENDPOINT
  MINIO_PUBLIC_ENDPOINT: z.string().default(''),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_CLIPS: z.string().default('clips'),

  // Video archive (recorder writes, retention deletes)
  ARCHIVE_ROOT: z.string().default('/archive'),

  // Clips worker
  CLIP_TMP_DIR: z.string().default('/tmp/clips'),
  CLIP_PRE_ROLL_SEC: z.coerce.number().default(10),
  CLIP_POST_ROLL_SEC: z.coerce.number().default(5),
  CLIP_WATERMARK: z.string().default('true').transform((v) => v === 'true'),
  CLIP_FONT: z.string().default('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
  FFMPEG_BIN: z.string().default('ffmpeg'),

  // Internal service-to-service auth (recorder → /internal/*)
  INTERNAL_TOKEN: z.string().min(8),

  // Alerts
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  // camera watchdog: heartbeat gone longer than this → camera_offline event
  CAMERA_OFFLINE_ALERT_SECONDS: z.coerce.number().default(300),
  MINIO_BUCKET_SNAPSHOTS: z.string().default('snapshots'),

  // Test-video upload → shared dir also mounted read-only into the analyzer.
  // A `file` camera gets url_sub = <TESTVIDEO_DIR>/<uuid>.<ext>.
  TESTVIDEO_DIR: z.string().default('/data'),
  UPLOAD_MAX_BYTES: z.coerce.number().default(5 * 1024 * 1024 * 1024), // 5 GB
})

export const config = EnvSchema.parse(process.env)
export type Config = typeof config
