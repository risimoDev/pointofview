import { NextResponse, type NextRequest } from 'next/server'

// Return from an organization to the platform: restore the parked super token.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const saved = req.cookies.get('super_token')?.value
  if (!saved) return new NextResponse(null, { status: 400 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set('token', saved, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
  res.cookies.delete('super_token')
  return res
}
