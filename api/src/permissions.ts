// Capability checkboxes the tenant owner grants to their users.
// Must stay in sync with PermissionCodes in shared/events.schema.ts (the web
// side imports it from there; api can't reach outside its rootDir).
export const PermissionCodes = [
  'live',      // дашборд и живое видео
  'events',    // события: просмотр, обработка, клипы
  'analytics', // аналитика
  'reports',   // отчёты (в т.ч. охрана труда)
  'zones',     // редактор зон
  'cameras',   // добавление и настройка камер
  'people',    // люди: сотрудники, галерея
  'alerts',    // правила оповещений
  'features',  // функции ИИ (вкл/выкл, пороги)
  'users',     // пользователи предприятия
] as const
export type PermissionCode = (typeof PermissionCodes)[number]

/**
 * Effective capabilities when a user has no explicit checkbox set
 * (permissions = null): pre-checkbox behavior per role. `super` and `admin`
 * (владелец предприятия) bypass permission checks entirely.
 */
export const ROLE_DEFAULT_PERMS: Record<string, readonly PermissionCode[]> = {
  super: PermissionCodes,
  admin: PermissionCodes,
  manager: ['live', 'events', 'analytics', 'reports', 'people', 'alerts', 'zones'],
  operator: ['live', 'events'],
}

export function effectivePerms(
  role: string, explicit: string[] | null | undefined,
): readonly string[] {
  if (role === 'super' || role === 'admin') return PermissionCodes
  if (Array.isArray(explicit)) return explicit
  return ROLE_DEFAULT_PERMS[role] ?? []
}

export function hasPerm(
  role: string, explicit: string[] | null | undefined, code: PermissionCode,
): boolean {
  return effectivePerms(role, explicit).includes(code)
}

/** Keep only known codes (defense against a tampered payload). */
export function sanitizePerms(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null
  const known = new Set<string>(PermissionCodes)
  return input.filter((c): c is string => typeof c === 'string' && known.has(c))
}
