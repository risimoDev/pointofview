import { NextResponse } from 'next/server'

// Relative Location so the browser resolves it against the public origin,
// not Next's internal bind address behind the reverse proxy (see login route).
export function POST(): NextResponse {
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } })
  res.cookies.delete('token')
  return res
}
