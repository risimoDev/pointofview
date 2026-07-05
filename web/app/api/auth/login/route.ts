import { NextResponse, type NextRequest } from 'next/server'

const API_URL = process.env.API_URL ?? 'http://localhost:3000'

// Relative Location: the browser resolves it against the public origin
// (https://<domain>) instead of Next's internal 0.0.0.0:3001 bind address,
// which is what an absolute URL built from req.url would wrongly produce
// behind the nginx/WireGuard reverse proxy.
function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')

  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) return seeOther('/login?error=1')

  const { token } = (await res.json()) as { token: string }
  const redirect = seeOther('/dashboard')
  redirect.cookies.set('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
  return redirect
}
