'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconShieldCheck,
  IconShieldLock,
  IconLayoutGrid,
  IconActivity,
  IconChartHistogram,
  IconFileAnalytics,
  IconVideo,
  IconAdjustmentsHorizontal,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'
import { getClaims, leaveOrg, type Claims } from '@/lib/api'
import { effectivePermsOf, type PermissionCode } from '@shared/events.schema'

type NavIcon = React.ComponentType<{ className?: string; stroke?: number }>

const NAV: { href: string; label: string; icon: NavIcon; perm: PermissionCode }[] = [
  { href: '/dashboard', label: 'Дашборд', icon: IconLayoutGrid, perm: 'live' },
  { href: '/events', label: 'События', icon: IconActivity, perm: 'events' },
  { href: '/analytics', label: 'Аналитика', icon: IconChartHistogram, perm: 'analytics' },
  { href: '/reports', label: 'Отчёты', icon: IconFileAnalytics, perm: 'reports' },
  // perm 'zones' → просмотр камер + переход в редактор зон; управление самими
  // камерами (добавление/удаление) — отдельное право 'cameras', /admin/cameras
  { href: '/settings/cameras', label: 'Зоны', icon: IconVideo, perm: 'zones' },
  { href: '/settings/features', label: 'Функции', icon: IconAdjustmentsHorizontal, perm: 'features' },
]

/** Global top bar for authenticated pages. Hidden on login and the redirect
 *  root so those stay full-bleed. */
export function AppNav(): React.JSX.Element | null {
  const pathname = usePathname()
  const [claims, setClaims] = useState<Claims | null>(null)

  useEffect(() => {
    let active = true
    getClaims()
      .then((c) => { if (active) setClaims(c) })
      .catch(() => undefined)
    return () => { active = false }
  }, [pathname])

  if (pathname === '/login' || pathname === '/' || pathname.startsWith('/invite')) return null

  // UX gating only — the API enforces permissions server-side
  const perms = new Set(effectivePermsOf(claims?.role ?? null, claims?.perms ?? null))
  const items = claims ? NAV.filter((i) => perms.has(i.perm)) : NAV
  const isSuper = claims?.role === 'super'
  const showAdmin = isSuper || claims?.role === 'admin' || perms.has('users')
  // super lands on platform diagnostics; everyone else lands on their
  // enterprise's admin home (/admin itself is super-only, see middleware.ts)
  const adminHref = isSuper ? '/admin' : '/admin/org'

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-0.5 border-b border-border/70 bg-background/80 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:gap-1 sm:px-4">
      <Link href="/dashboard" className="mr-1 flex shrink-0 items-center gap-2 sm:mr-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/30">
          <IconShieldCheck className="h-4 w-4" stroke={1.9} />
        </span>
        <span className="hidden font-display text-base font-semibold tracking-tight sm:inline">
          BZK-VIZI<span className="text-brand">AI</span>
        </span>
      </Link>

      <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto sm:gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-3',
                active && 'bg-accent text-foreground',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" stroke={1.75} />
              <span className="hidden md:inline">{label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        {claims?.imp && (
          <button
            type="button"
            onClick={() => { void leaveOrg().then(() => { window.location.href = '/admin/orgs' }) }}
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 transition-colors hover:bg-amber-500/20"
            title="Вы вошли в организацию из платформы"
          >
            ← В платформу
          </button>
        )}
        {showAdmin && (
          <Link
            href={adminHref}
            title="Админ"
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-3',
              pathname.startsWith('/admin') && 'bg-accent text-foreground',
            )}
          >
            <IconShieldLock className="h-[18px] w-[18px] shrink-0" stroke={1.75} />
            <span className="hidden md:inline">Админ</span>
          </Link>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}
