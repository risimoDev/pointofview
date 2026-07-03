import { NextResponse, type NextRequest } from 'next/server'

const API_URL = process.env.API_URL ?? 'http://localhost:3000'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')

  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    return NextResponse.redirect(new URL('/login?error=1', req.url), { status: 303 })
  }

  const { token } = (await res.json()) as { token: string }
  const redirect = NextResponse.redirect(new URL('/dashboard', req.url), { status: 303 })
  redirect.cookies.set('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
  return redirect
}
