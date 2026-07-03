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
  { href: '/admin/cameras', label: 'Камеры', icon: IconVideo, ready: true },
  { href: '/admin/features', label: 'Функции', icon: IconAdjustmentsHorizontal, ready: true },
  { href: '/admin/alerts', label: 'Алерты', icon: IconBell, ready: true },
  { href: '/admin/video', label: 'Видео-тесты', icon: IconPlayerPlay, ready: true },
  { href: '/admin/maintenance', label: 'Обслуживание', icon: IconTool, ready: true },
]

export function AdminNav(): React.JSX.Element {
  const pathname = usePathname()
  return (
    <nav className="w-52 shrink-0 space-y-0.5">
      <div className="px-3 pb-2 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Супер-админ
      </div>
      {ITEMS.map(({ href, label, icon: Icon, ready }) => {
        if (!ready) {
          return (
            <div
              key={href}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground/40"
            >
              <Icon className="h-[18px] w-[18px]" stroke={1.75} />
              {label}
              <span className="ml-auto text-[10px] uppercase">скоро</span>
            </div>
          )
        }
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              active && 'bg-accent text-foreground',
            )}
          >
            <Icon className="h-[18px] w-[18px]" stroke={1.75} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
