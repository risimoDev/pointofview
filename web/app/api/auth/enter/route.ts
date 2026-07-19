import { NextResponse, type NextRequest } from 'next/server'

// Platform → organization switch for super: the org-scoped JWT becomes the
// session cookie, the super token is parked in super_token to return later.
const COOKIE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 12,
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string }
  if (!token) return new NextResponse(null, { status: 400 })
  const res = NextResponse.json({ ok: true })
  const current = req.cookies.get('token')?.value
  if (current) res.cookies.set('super_token', current, COOKIE)
  res.cookies.set('token', token, COOKIE)
  return res
}
