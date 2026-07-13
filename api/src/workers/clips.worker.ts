import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { archiveSegment, camera, event, site } from '../../db/schema.js'
import { config } from '../config.js'
import { CLIPS_QUEUE, type ClipJob } from '../queues.js'
import { CLIPS_BUCKET, ensureBucket, minio } from '../minio.js'
import { settingBool, settingNumber } from '../settings.js'

const log = (msg: string, extra?: unknown): void => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, extra }))
}

function ffmpegEscape(text: string): string {
  // drawtext text escaping: backslash, colon, single quote, percent
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

async function processClip(job: Job<ClipJob>): Promise<{ clipKey: string }> {
  const { event_id, camera_id, ts_start, ts_end, tenant_id } = job.data

  // rolls/watermark are admin-tunable (/admin/settings); env is the fallback
  const preRoll = await settingNumber('clip_pre_roll_sec')
  const postRoll = await settingNumber('clip_post_roll_sec')
  const watermark = await settingBool('clip_watermark')

  const startWindow = new Date(new Date(ts_start).getTime() - preRoll * 1000)
  const endWindow = new Date(new Date(ts_end).getTime() + postRoll * 1000)

  // 1. segments covering the window
  const segs = await db.select().from(archiveSegment)
    .where(and(
      eq(archiveSegment.cameraId, camera_id),
      lte(archiveSegment.startedAt, endWindow),
      or(gte(archiveSegment.endedAt, startWindow), isNull(archiveSegment.endedAt)),
    ))
    .orderBy(asc(archiveSegment.startedAt))

  const first = segs[0]
  if (!first) throw new Error(`no archive segments for camera ${camera_id} in window`)

  // watermark context
  const [meta] = await db.select({ siteName: site.name, tz: site.timezone })
    .from(camera).innerJoin(site, eq(camera.siteId, site.id))
    .where(eq(camera.id, camera_id)).limit(1)

  await mkdir(config.CLIP_TMP_DIR, { recursive: true })
  const uid = randomUUID()
  const listPath = join(config.CLIP_TMP_DIR, `${uid}.txt`)
  const outPath = join(config.CLIP_TMP_DIR, `${uid}.mp4`)

  // 2. concat list
  const listBody = segs.map((s) => `file '${s.filePath.replace(/'/g, "'\\''")}'`).join('\n')
  await writeFile(listPath, `${listBody}\n`, 'utf8')

  // 3. trim relative to first segment start
  const ss = Math.max(0, (startWindow.getTime() - first.startedAt.getTime()) / 1000)
  const dur = (endWindow.getTime() - startWindow.getTime()) / 1000

  const base = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-ss', ss.toFixed(3), '-t', dur.toFixed(3)]

  let args: string[]
  if (watermark && meta) {
    const tsLocal = new Intl.DateTimeFormat('ru-RU', {
      timeZone: meta.tz, dateStyle: 'short', timeStyle: 'medium',
    }).format(new Date(ts_start))
    const wm = ffmpegEscape(`${meta.siteName} | ${tsLocal}`)
    const vf = `drawtext=fontfile=${config.CLIP_FONT}:text='${wm}'`
      + `:fontcolor=white:fontsize=20:x=10:y=10:box=1:boxcolor=black@0.4:boxborderw=6`
    // drawtext requires re-encode → -c copy is not possible with a watermark
    args = [...base, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'copy', outPath]
  } else {
    args = [...base, '-c', 'copy', outPath]
  }

  try {
    await runFfmpeg(args)

    // 5. upload to MinIO
    const clipKey = `${tenant_id}/${event_id}.mp4`
    await minio.fPutObject(CLIPS_BUCKET, clipKey, outPath, { 'Content-Type': 'video/mp4' })

    // 6. persist clip_key
    await db.update(event).set({ clipKey }).where(eq(event.id, event_id))

    log('clip ready', { event_id, clipKey })
    return { clipKey }
  } finally {
    // 7. cleanup tmp
    await Promise.allSettled([rm(outPath, { force: true }), rm(listPath, { force: true })])
  }
}

async function main(): Promise<void> {
  await ensureBucket(CLIPS_BUCKET)
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const worker = new Worker<ClipJob>(CLIPS_QUEUE, processClip, { connection: connection as ConnectionOptions, concurrency: 2 })

  worker.on('failed', (job, err) => log('clip job failed', { id: job?.id, err: err.message }))
  worker.on('completed', (job) => log('clip job completed', { id: job.id }))

  const shutdown = async (): Promise<void> => {
    await worker.close()
    await connection.quit()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  log('clips worker started', { concurrency: 2 })
}

void main()
