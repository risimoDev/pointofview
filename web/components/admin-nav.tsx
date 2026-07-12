'use client'

import type * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconActivityHeartbeat,
  IconUsersGroup,
  IconVideo,
  IconAdjustmentsHorizontal,
  IconBell,
  IconPlayerPlay,
  IconTool,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'

type NavIcon = React.ComponentType<{ className?: string; stroke?: number }>

const ITEMS: { href: string; label: string; icon: NavIcon; ready: boolean }[] = [
  { href: '/admin', label: 'Диагностика', icon: IconActivityHeartbeat, ready: true },
  { href: '/admin/org', label: 'Организация', icon: IconUsersGroup, ready: true },
  { href: '/admin/people', label: 'Люди', icon: IconUsersGroup, ready: true },
  { href: '/admin/cameras', label: 'Камеры', icon: IconVideo, ready: true },
  { href: '/admin/features', label: 'Функции', icon: IconAdjustmentsHorizontal, ready: true },
  { href: '/admin/alerts', label: 'Алерты', icon: IconBell, ready: true },
  { href: '/admin/video', label: 'Видео-тесты', icon: IconPlayerPlay, ready: true },
  { href: '/admin/maintenance', label: 'Обслуживание', icon: IconTool, ready: true },
]

export function AdminNav(): React.JSX.Element {
  const pathname = usePathname()
  return (
    <nav className="flex shrink-0 gap-0.5 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible md:pb-0">
      <div className="hidden px-3 pb-2 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground md:block">
        Супер-админ
      </div>
      {ITEMS.map(({ href, label, icon: Icon, ready }) => {
        if (!ready) {
          return (
            <div
              key={href}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground/40"
            >
              <Icon className="h-[18px] w-[18px] shrink-0" stroke={1.75} />
              {label}
              <span className="ml-auto hidden text-[10px] uppercase md:inline">скоро</span>
            </div>
          )
        }
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
