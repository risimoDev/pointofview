import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC = ['/login', '/api/auth']

function roleFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch {
    return null
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
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p))

  if (!token && !isPublic) {
    return redirect(req, '/login')
  }
  if (token && pathname === '/login') {
    return redirect(req, '/dashboard')
  }
  // Super-admin area: UX gate (the API enforces role=super for real).
  if (token && pathname.startsWith('/admin') && roleFromToken(token) !== 'super') {
    return redirect(req, '/dashboard')
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|alert.mp3).*)'],
}
