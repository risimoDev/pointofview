'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconActivityHeartbeat,
  IconBuildingSkyscraper,
  IconUsersGroup,
  IconVideo,
  IconAdjustmentsHorizontal,
  IconBell,
  IconPlayerPlay,
  IconTool,
  IconSettings,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { getClaims, type Claims } from '@/lib/api'
import { effectivePermsOf, type PermissionCode } from '@shared/events.schema'

type NavIcon = React.ComponentType<{ className?: string; stroke?: number }>
type Scope = 'super' | PermissionCode

// scope 'super' = service-level page; a PermissionCode = enterprise page the
// owner (or a user with that checkbox) can open. UX only — the API enforces.
const ITEMS: { href: string; label: string; icon: NavIcon; scope: Scope }[] = [
  { href: '/admin/orgs', label: 'Организации', icon: IconBuildingSkyscraper, scope: 'super' },
  { href: '/admin', label: 'Диагностика', icon: IconActivityHeartbeat, scope: 'super' },
  { href: '/admin/org', label: 'Доступы', icon: IconUsersGroup, scope: 'users' },
  { href: '/admin/people', label: 'Люди', icon: IconUsersGroup, scope: 'people' },
  { href: '/admin/cameras', label: 'Камеры', icon: IconVideo, scope: 'cameras' },
  { href: '/admin/features', label: 'Функции', icon: IconAdjustmentsHorizontal, scope: 'features' },
  { href: '/admin/alerts', label: 'Алерты', icon: IconBell, scope: 'alerts' },
  { href: '/admin/video', label: 'Видео-тесты', icon: IconPlayerPlay, scope: 'super' },
  { href: '/admin/settings', label: 'Настройки сервера', icon: IconSettings, scope: 'super' },
  { href: '/admin/maintenance', label: 'Обслуживание', icon: IconTool, scope: 'super' },
]

export function AdminNav(): React.JSX.Element {
  const pathname = usePathname()
  const [claims, setClaims] = useState<Claims | null>(null)

  useEffect(() => {
    let active = true
    getClaims().then((c) => { if (active) setClaims(c) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const isSuper = claims?.role === 'super'
  const perms = new Set(effectivePermsOf(claims?.role ?? null, claims?.perms ?? null))
  const items = ITEMS.filter((i) =>
    i.scope === 'super' ? isSuper : perms.has(i.scope))

  return (
    <nav className="flex shrink-0 gap-0.5 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible md:pb-0">
      <div className="hidden px-3 pb-2 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground md:block">
        {isSuper ? 'Платформа' : 'Администрирование'}
      </div>
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              active && 'bg-accent text-foreground',
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" stroke={1.75} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
