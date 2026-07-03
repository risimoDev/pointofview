import { NextResponse, type NextRequest } from 'next/server'

export function POST(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/login', req.url), { status: 303 })
  res.cookies.delete('token')
  return res
}
