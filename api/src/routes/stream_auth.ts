import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { camera, site } from '../../db/schema.js'
import { hasPerm } from '../permissions.js'
import type { JwtPayload } from '../plugins/auth.js'

/**
 * Gatekeeper for the go2rtc proxy (`nginx auth_request`).
 *
 * Live video is served by go2rtc, which has no authentication of its own and
 * was proxied straight to the internet at /go2rtc/. That meant anyone could
 * open /go2rtc/api/streams and read every camera's RTSP URL — passwords
 * included — add streams of their own, or watch any camera by its id. nginx
 * now allows only the two paths the player needs and asks this endpoint first.
 *
 * Reads the session from the `token` COOKIE rather than the Authorization
 * header: a <video> element and a WebSocket opened by the player cannot set
 * headers, which is the whole reason the proxy was unauthenticated to begin
 * with. The cookie is httpOnly and same-origin, so it rides along by itself.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

/** `src` of the original request (nginx passes it in X-Original-URI). */
function srcFromUri(uri: string | undefined): string | null {
  if (!uri) return null
  const q = uri.indexOf('?')
  if (q < 0) return null
  return new URLSearchParams(uri.slice(q + 1)).get('src')
}

const streamAuthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/stream-auth', async (req, reply) => {
    const token = cookieValue(req.headers.cookie, 'token')
    if (!token) return reply.code(401).send()

    let payload: JwtPayload
    try {
      payload = app.jwt.verify<JwtPayload>(token)
    } catch {
      return reply.code(401).send()
    }
    if (!hasPerm(payload.role, payload.perms ?? null, 'live')) {
      return reply.code(403).send()
    }

    // The MSE/WebSocket path names the camera, so it can be checked exactly.
    // HLS segment URLs carry no src — those get a valid-session check only,
    // which is still the difference between "any stranger" and "someone who
    // logged into this organisation".
    const src = srcFromUri(req.headers['x-original-uri'] as string | undefined)
    if (src) {
      // reject before the query: a non-uuid would make Postgres throw, and an
      // auth_request that 500s is a denial the operator has to debug blind
      if (!UUID_RE.test(src)) return reply.code(403).send()
      const cams = payload.cams ?? []
      if (cams.length > 0 && !cams.includes(src)) return reply.code(403).send()
      const [row] = await db.select({ id: camera.id }).from(camera)
        .innerJoin(site, eq(camera.siteId, site.id))
        .where(and(eq(camera.id, src), eq(site.tenantId, payload.tenant_id)))
        .limit(1)
      if (!row) return reply.code(403).send()
    }
    return reply.code(204).send()
  })
}

export default streamAuthRoutes
