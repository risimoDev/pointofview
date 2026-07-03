import Redis from 'ioredis'
import { config } from './config.js'

// Separate connections: blocking stream reads / pubsub need dedicated sockets.
export function makeRedis(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
}
