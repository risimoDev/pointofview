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

export function middleware(req: NextRequest): NextResponse {
  const token = req.cookies.get('token')?.value
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p))

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  // Super-admin area: UX gate (the API enforces role=super for real).
  if (token && pathname.startsWith('/admin') && roleFromToken(token) !== 'super') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|alert.mp3).*)'],
}
