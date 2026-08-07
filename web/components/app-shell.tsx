'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconShieldCheck, IconLayoutGrid, IconActivity, IconChartHistogram,
  IconFileAnalytics, IconVideo, IconPlayerPlay, IconAdjustmentsHorizontal,
  IconBuildingSkyscraper, IconUsersGroup, IconBell, IconSchool, IconTool,
  IconSettings, IconActivityHeartbeat, IconMenu2, IconX,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'
import { LearningBanner } from '@/components/learning-banner'
import { getClaims, leaveOrg, type Claims } from '@/lib/api'
import { effectivePermsOf, type PermissionCode } from '@shared/events.schema'
import { roleLabels } from '@/lib/labels'

/**
 * Console shell: a fixed left rail plus a content column that scrolls on its
 * own. Replaces the top bar.
 *
 * The rail also absorbs the admin sub-navigation that used to live inside
 * /admin pages. Both lists were permission-gated in two different places and
 * drifted apart; one list in one file cannot.
 *
 * Gating here is UX only — the API enforces every one of these.
 */

type NavIcon = React.ComponentType<{ className?: string; stroke?: number }>
type Scope = 'super' | PermissionCode

const MAIN: { href: string; label: string; icon: NavIcon; scope: Scope }[] = [
  { href: '/dashboard', label: 'Дашборд', icon: IconLayoutGrid, scope: 'live' },
  { href: '/events', label: 'События', icon: IconActivity, scope: 'events' },
  { href: '/archive', label: 'Архив', icon: IconPlayerPlay, scope: 'live' },
  { href: '/analytics', label: 'Аналитика', icon: IconChartHistogram, scope: 'analytics' },
  { href: '/reports', label: 'Отчёты', icon: IconFileAnalytics, scope: 'reports' },
  { href: '/settings/cameras', label: 'Зоны', icon: IconVideo, scope: 'zones' },
  { href: '/settings/features', label: 'Функции', icon: IconAdjustmentsHorizontal, scope: 'features' },
]

const ADMIN: { href: string; label: string; icon: NavIcon; scope: Scope }[] = [
  { href: '/admin/org', label: 'Доступы', icon: IconUsersGroup, scope: 'users' },
  { href: '/admin/people', label: 'Люди', icon: IconUsersGroup, scope: 'people' },
  { href: '/admin/cameras', label: 'Камеры', icon: IconVideo, scope: 'cameras' },
  { href: '/admin/features', label: 'Функции ИИ', icon: IconAdjustmentsHorizontal, scope: 'features' },
  { href: '/admin/alerts', label: 'Оповещения', icon: IconBell, scope: 'alerts' },
]

const PLATFORM: { href: string; label: string; icon: NavIcon }[] = [
  { href: '/admin/orgs', label: 'Организации', icon: IconBuildingSkyscraper },
  { href: '/admin', label: 'Диагностика', icon: IconActivityHeartbeat },
  { href: '/admin/training', label: 'Обучение', icon: IconSchool },
  { href: '/admin/video', label: 'Видео-тесты', icon: IconPlayerPlay },
  { href: '/admin/settings', label: 'Настройки сервера', icon: IconSettings },
  { href: '/admin/maintenance', label: 'Обслуживание', icon: IconTool },
]

/** Routes that render their own full-bleed page and must not get the rail. */
function isBare(pathname: string): boolean {
  return pathname === '/login' || pathname === '/' || pathname.startsWith('/invite')
}

function NavLink({ href, label, icon: Icon, active, onNavigate }: {
  href: string; label: string; icon: NavIcon; active: boolean
  onNavigate: () => void
}): React.JSX.Element {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active && 'bg-accent text-foreground',
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" stroke={1.75} />
      <span className="truncate">{label}</span>
    </Link>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-2.5 pb-1 pt-3 font-display text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname()
  const [claims, setClaims] = useState<Claims | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    getClaims().then((c) => { if (active) setClaims(c) }).catch(() => undefined)
    return () => { active = false }
  }, [pathname])

  // close the drawer on navigation
  useEffect(() => { setOpen(false) }, [pathname])

  if (isBare(pathname)) return <>{children}</>

  const perms = new Set(effectivePermsOf(claims?.role ?? null, claims?.perms ?? null))
  const isSuper = claims?.role === 'super'
  const allow = (scope: Scope): boolean => scope === 'super' ? isSuper : perms.has(scope)
  // before claims load, show the full list rather than an empty rail that
  // flashes and then fills in
  const main = claims ? MAIN.filter((i) => allow(i.scope)) : MAIN
  const admin = claims ? ADMIN.filter((i) => allow(i.scope)) : []
  const platform = isSuper ? PLATFORM : []

  const isActive = (href: string): boolean =>
    pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`))

  const rail = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/70 bg-card/40">
      <div className="flex h-14 items-center gap-2 border-b border-border/70 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/30">
          <IconShieldCheck className="h-4 w-4" stroke={1.9} />
        </span>
        <span className="font-display text-base font-semibold tracking-tight">
          BZK-VIZI<span className="text-brand">AI</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden"
          aria-label="Закрыть меню"
        >
          <IconX className="h-5 w-5" stroke={1.75} />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {main.map((i) => (
          <NavLink key={i.href} {...i} active={isActive(i.href)} onNavigate={() => setOpen(false)} />
        ))}

        {admin.length > 0 && (
          <>
            <GroupLabel>Администрирование</GroupLabel>
            {admin.map((i) => (
              <NavLink key={i.href} {...i} active={isActive(i.href)} onNavigate={() => setOpen(false)} />
            ))}
          </>
        )}

        {platform.length > 0 && (
          <>
            <GroupLabel>Платформа</GroupLabel>
            {platform.map((i) => (
              <NavLink key={i.href} {...i} active={isActive(i.href)} onNavigate={() => setOpen(false)} />
            ))}
          </>
        )}
      </nav>

      <div className="space-y-2 border-t border-border/70 p-3">
        {claims?.imp && (
          <button
            type="button"
            onClick={() => { void leaveOrg().then(() => { window.location.href = '/admin/orgs' }) }}
            className="flex w-full items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300 transition-colors hover:bg-amber-500/20"
            title="Вы вошли в организацию из платформы"
          >
            ← Вернуться в платформу
          </button>
        )}
        <div className="flex items-center gap-2 px-1">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">
            {isSuper ? 'ПЛ' : 'ОР'}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-medium">
              {isSuper ? 'Платформа' : 'Организация'}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {claims?.role ? roleLabels[claims.role as keyof typeof roleLabels] ?? claims.role : '—'}
            </span>
          </span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* desktop rail */}
      <div className="hidden lg:flex">{rail}</div>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="relative">{rail}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* compact bar: only exists to reach the drawer on a phone */}
        <div className="flex h-12 items-center gap-2 border-b border-border/70 px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Меню"
          >
            <IconMenu2 className="h-5 w-5" stroke={1.75} />
          </button>
          <span className="font-display text-sm font-semibold">
            BZK-VIZI<span className="text-brand">AI</span>
          </span>
        </div>

        <LearningBanner />

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
