// Camera stream URLs carry credentials (rtsp://user:pass@host/...). API
// responses must never expose the password: it is masked as `***` on the way
// out, and PATCH accepts the same `***` back as a "keep the stored password"
// sentinel so the edit form can round-trip a masked URL unchanged.
// DB, Redis (cameras:{tenant} for the analyzer) and go2rtc always get raw URLs.

const CRED_RE = /^([a-z][a-z0-9+.-]*:\/\/)([^:@/?#]+):([^@]+)@/i

export const PASSWORD_MASK = '***'

/** Mask the password part of a URL (`rtsp://user:***@...`). No-op for URLs without credentials (file paths etc.). */
export function maskStreamUrl(url: string | null): string | null {
  if (!url) return url
  return url.replace(CRED_RE, (_m, proto: string, user: string) => `${proto}${user}:${PASSWORD_MASK}@`)
}

/** True when the URL carries the `***` placeholder instead of a real password. */
export function hasMaskedPassword(url: string | null | undefined): boolean {
  if (!url) return false
  const m = CRED_RE.exec(url)
  return m?.[3] === PASSWORD_MASK
}

/**
 * Replace the `***` placeholder in an incoming URL with the password taken
 * from the previously stored URL of the same field. Returns null when there is
 * no stored password to keep (caller should reject with 400).
 */
export function restoreMaskedPassword(incoming: string, stored: string | null): string | null {
  const m = stored ? CRED_RE.exec(stored) : null
  const password = m?.[3]
  if (!password || password === PASSWORD_MASK) return null
  return incoming.replace(CRED_RE, (_m, proto: string, user: string) => `${proto}${user}:${password}@`)
}

/** Copy of a camera row with masked stream URLs — for every API response. */
export function maskCameraUrls<T extends { urlMain: string | null; urlSub: string | null }>(row: T): T {
  return { ...row, urlMain: maskStreamUrl(row.urlMain), urlSub: maskStreamUrl(row.urlSub) }
}
