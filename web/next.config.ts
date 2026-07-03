import type { NextConfig } from 'next'

const API_URL = process.env.API_URL ?? 'http://localhost:3000'
const GO2RTC_URL = process.env.GO2RTC_URL ?? 'http://localhost:1984'

const nextConfig: NextConfig = {
  output: 'standalone',
  // allow importing zod schemas from ../shared
  outputFileTracingRoot: process.cwd() + '/..',
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` },
      { source: '/go2rtc/:path*', destination: `${GO2RTC_URL}/:path*` },
    ]
  },
}

export default nextConfig
