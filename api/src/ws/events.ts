import type { FastifyBaseLogger } from 'fastify'
import type Redis from 'ioredis'
import type { WebSocket } from 'ws'

/**
 * Fan-out hub: one Redis subscriber connection, per-tenant channels
 * `events:{tenant_id}`. Subscribes on first client of a tenant,
 * unsubscribes on last. EventConsumer PUBLISHes after a successful insert.
 */
export class WsHub {
  private readonly byTenant = new Map<string, Set<WebSocket>>()

  constructor(private readonly sub: Redis, private readonly log: FastifyBaseLogger) {
    this.sub.on('message', (channel: string, message: string) => {
      const tenant = channel.slice('events:'.length)
      const set = this.byTenant.get(tenant)
      if (!set) return
      for (const ws of set) {
        if (ws.readyState === ws.OPEN) ws.send(message)
      }
    })
  }

  async add(tenantId: string, ws: WebSocket): Promise<void> {
    let set = this.byTenant.get(tenantId)
    if (!set) {
      set = new Set()
      this.byTenant.set(tenantId, set)
      await this.sub.subscribe(`events:${tenantId}`)
    }
    set.add(ws)
  }

  async remove(tenantId: string, ws: WebSocket): Promise<void> {
    const set = this.byTenant.get(tenantId)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) {
      this.byTenant.delete(tenantId)
      await this.sub.unsubscribe(`events:${tenantId}`).catch((err) => {
        this.log.warn({ err, tenantId }, 'unsubscribe failed')
      })
    }
  }
}
