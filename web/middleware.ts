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

// Relative Location so the browser resolves against the public origin instead
// of Next's internal 0.0.0.0:3001 behind the reverse proxy (see login route).
function redirect(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } })
}

export function middleware(req: NextRequest): NextResponse {
  const token = req.cookies.get('token')?.value
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p))

  if (!token && !isPublic) {
    return redirect('/login')
  }
  if (token && pathname === '/login') {
    return redirect('/dashboard')
  }
  // Super-admin area: UX gate (the API enforces role=super for real).
  if (token && pathname.startsWith('/admin') && roleFromToken(token) !== 'super') {
    return redirect('/dashboard')
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|alert.mp3).*)'],
}
