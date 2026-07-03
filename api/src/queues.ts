import { Queue, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'
import { config } from './config.js'

export interface ClipJob {
  event_id: string
  camera_id: string
  ts_start: string // ISO
  ts_end: string   // ISO
  tenant_id: string
}

// BullMQ requires maxRetriesPerRequest: null on its connections.
export const bullConnection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

export const CLIPS_QUEUE = 'clips'
export const clipsQueue = new Queue<ClipJob>(CLIPS_QUEUE, { connection: bullConnection as ConnectionOptions })

export interface AlertJob {
  event_id: string
  tenant_id: string
}

export const ALERTS_QUEUE = 'alerts'
export const alertsQueue = new Queue<AlertJob>(ALERTS_QUEUE, { connection: bullConnection as ConnectionOptions })
