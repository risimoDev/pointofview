import type { FastifyRequest } from 'fastify'
import type Redis from 'ioredis'

// RFC1918 + loopback + link-local + IPv6 unique-local/link-local — everything
// our own proxy hops (VPS nginx, docker nginx, web container) appear as.
const PRIVATE_IP_RE = /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i

/**
 * Real client IP behind the proxy chain (VPS nginx → docker nginx → optionally
 * the Next.js login route, which forwards X-Forwarded-For verbatim). The left
 * side of the header is client-controlled (spoofable), so take the RIGHTMOST
 * public address — everything to its right was appended by our own
 * private-network hops. Falls back to the socket address when the header is
 * absent or all-private (dev, on-premise LAN).
 */
export function clientIp(req: FastifyRequest): string {
  const raw = req.headers['x-forwarded-for']
  const header = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  const parts = header.split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!PRIVATE_IP_RE.test(parts[i]!)) return parts[i]!
  }
  return req.ip
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSec: number
}

/** Fixed-window counter (INCR + EXPIRE), same pattern as demo_req / cooldown. */
export async function rateLimit(
  redis: Redis, key: string, limit: number, windowSec: number,
): Promise<RateLimitResult> {
  const hits = await redis.incr(key)
  if (hits === 1) await redis.expire(key, windowSec)
  if (hits <= limit) return { allowed: true, retryAfterSec: 0 }
  const ttl = await redis.ttl(key)
  return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec }
}
