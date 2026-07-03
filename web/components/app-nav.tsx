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
  IconVideo,
  IconAdjustmentsHorizontal,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'
import { getRole } from '@/lib/api'

type NavIcon = React.ComponentType<{ className?: string; stroke?: number }>

const NAV: { href: string; label: string; icon: NavIcon }[] = [
  { href: '/dashboard', label: 'Дашборд', icon: IconLayoutGrid },
  { href: '/events', label: 'События', icon: IconActivity },
  { href: '/settings/cameras', label: 'Камеры', icon: IconVideo },
  { href: '/settings/features', label: 'Функции', icon: IconAdjustmentsHorizontal },
]

/** Global top bar for authenticated pages. Hidden on login and the redirect
 *  root so those stay full-bleed. */
export function AppNav(): React.JSX.Element | null {
  const pathname = usePathname()
  const [isSuper, setIsSuper] = useState(false)

  useEffect(() => {
    let active = true
    getRole()
      .then((r) => { if (active) setIsSuper(r === 'super') })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  if (pathname === '/login' || pathname === '/') return null

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-1 border-b border-border/70 bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link href="/dashboard" className="mr-5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/30">
          <IconShieldCheck className="h-4 w-4" stroke={1.9} />
        </span>
        <span className="font-display text-base font-semibold tracking-tight">
          BZK-VIZI<span className="text-brand">AI</span>
        </span>
      </Link>

      <nav className="flex items-center gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
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

      <div className="ml-auto flex items-center gap-1">
        {isSuper && (
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              pathname.startsWith('/admin') && 'bg-accent text-foreground',
            )}
          >
            <IconShieldLock className="h-[18px] w-[18px]" stroke={1.75} />
            Админ
          </Link>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}
