import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import type Redis from 'ioredis'
import type { WebSocket } from 'ws'
import { config } from './config.js'
import { makeRedis } from './redis.js'
import authPlugin from './plugins/auth.js'
import authRoutes from './routes/auth.js'
import eventsRoutes from './routes/events.js'
import camerasRoutes, { startGo2rtcReconciler } from './routes/cameras.js'
import analyticsRoutes from './routes/analytics.js'
import featuresRoutes from './routes/features.js'
import adminRoutes from './routes/admin.js'
import internalRoutes from './routes/internal.js'
import { EventConsumer } from './streams/event_consumer.js'
import { WsHub } from './ws/events.js'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // Redis: command conn (routes/ack/publish), stream conn (blocking reads), sub conn
  const redisCmd = makeRedis()
  const redisStream = makeRedis()
  const redisSub = makeRedis()

  await app.register(authPlugin)
  app.decorate('redis', redisCmd)
  await app.register(websocket)
  // test-video upload (admin): stream large files straight to disk
  await app.register(multipart, { limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1 } })

  // liveness probe for docker healthcheck / edge monitoring
  app.get('/api/v1/health', async () => {
    await redisCmd.ping()
    return { status: 'ok' }
  })

  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(eventsRoutes, { prefix: '/api/v1' })
  await app.register(camerasRoutes, { prefix: '/api/v1' })
  await app.register(analyticsRoutes, { prefix: '/api/v1' })
  await app.register(featuresRoutes, { prefix: '/api/v1' })
  await app.register(adminRoutes, { prefix: '/api/v1/admin' })
  await app.register(internalRoutes, { prefix: '/internal' })

  // WebSocket live events
  const hub = new WsHub(redisSub, app.log)
  app.get('/api/v1/ws/events', { websocket: true }, async (socket: WebSocket, req) => {
    const ticket = (req.query as { ticket?: string }).ticket
    // single-use: GETDEL consumes the ticket so it can't be replayed from logs
    const tenantId = ticket ? await redisCmd.getdel(`ws_ticket:${ticket}`) : null
    if (!tenantId) {
      socket.close(1008, 'unauthorized')
      return
    }
    void hub.add(tenantId, socket)
    socket.on('close', () => void hub.remove(tenantId, socket))
  })

  // Redis Streams → PostgreSQL consumer
  const consumer = new EventConsumer(redisStream, redisCmd, app.log)
  await consumer.start()

  // Keep go2rtc's (in-memory, wiped on its restart) streams in sync with the DB
  const stopReconciler = startGo2rtcReconciler(app.log)

  const shutdown = async (): Promise<void> => {
    stopReconciler()
    consumer.stop()
    await app.close()
    await Promise.allSettled([redisCmd.quit(), redisStream.quit(), redisSub.quit()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  await app.listen({ host: config.API_HOST, port: config.API_PORT })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err)
  process.exit(1)
})
