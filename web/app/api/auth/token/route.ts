import { NextResponse, type NextRequest } from 'next/server'

// Echo the httpOnly cookie token so the client can build Authorization
// headers and the WebSocket query param.
export function GET(req: NextRequest): NextResponse {
  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.json({ message: 'unauthenticated' }, { status: 401 })
  return NextResponse.json({ token })
}
