import { NextResponse, type NextRequest } from 'next/server'
import { effectivePermsOf } from '@shared/events.schema'

const PUBLIC = ['/login', '/api/auth', '/invite']

// Service-level (super-only) admin subpages — platform diagnostics, the
// cross-tenant org list, and server-wide settings. Everything else under
// /admin/* (org/people/cameras/features/alerts) is the TENANT-OWNER admin
// area: real access is enforced by the API (requirePerm/requireOwner) and by
// admin-nav.tsx hiding links the caller's checkboxes don't cover — this gate
// only keeps users with zero admin-area permission from loading a shell full
// of 403s.
const SUPER_ONLY_ADMIN_PATHS = ['/admin/orgs', '/admin/video', '/admin/settings', '/admin/maintenance']
// scopes admin-nav.tsx uses for non-super items (see that file's `ITEMS`)
const ADMIN_AREA_PERMS = ['users', 'people', 'cameras', 'features', 'alerts']

interface Claims { role: string | null; perms: string[] | null }

function claimsFromToken(token: string): Claims {
  try {
    const payload = token.split('.')[1]
    if (!payload) return { role: null, perms: null }
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed = JSON.parse(json) as { role?: string; perms?: unknown }
    return {
      role: parsed.role ?? null,
      perms: Array.isArray(parsed.perms)
        ? parsed.perms.filter((p): p is string => typeof p === 'string')
        : null,
    }
  } catch {
    return { role: null, perms: null }
  }
}

// Build the redirect from req.nextUrl (a valid NextURL parsed from the request
// Host header) — NOT new URL(req.url), which throws "Invalid URL" in middleware,
// and NOT a bare relative Location, which middleware also can't parse. Behind
// the proxy nextUrl.host is the public domain (nginx forwards Host), so this
// lands on the right origin.
function redirect(req: NextRequest, path: string): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = path
  url.search = ''
  return NextResponse.redirect(url)
}

export function middleware(req: NextRequest): NextResponse {
  const token = req.cookies.get('token')?.value
  const { pathname } = req.nextUrl
  // '/' is the public landing; /api/v1/public/* is the landing's lead form
  const isPublic = pathname === '/'
    || PUBLIC.some((p) => pathname.startsWith(p))
    || pathname.startsWith('/api/v1/public')

  if (!token && !isPublic) {
    return redirect(req, '/login')
  }
  // logged-in users land straight in the product
  if (token && (pathname === '/login' || pathname === '/')) {
    return redirect(req, '/dashboard')
  }
  if (token && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    const { role, perms } = claimsFromToken(token)
    const isSuperOnly = pathname === '/admin'
      || SUPER_ONLY_ADMIN_PATHS.some((p) => pathname.startsWith(p))
    if (isSuperOnly) {
      if (role !== 'super') return redirect(req, '/dashboard')
    } else {
      // tenant-owner area: admin/super get every PermissionCode from
      // effectivePermsOf, so this alone covers owners too — a manager/
      // operator needs at least one of the checkboxes admin-nav.tsx uses
      const effective = effectivePermsOf(role, perms)
      if (!ADMIN_AREA_PERMS.some((p) => effective.includes(p))) {
        return redirect(req, '/dashboard')
      }
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|alert.mp3).*)'],
}
