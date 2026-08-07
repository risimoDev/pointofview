import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Screen furniture shared by every console page, so the redesign is one file
 * rather than twenty copies of the same header markup.
 *
 * Layout contract: the shell owns the scroll container, so a page is just a
 * padded column. Pages that must fill the viewport (dashboard, archive) pass
 * `fill` and manage their own inner scrolling.
 */

export function Page({ children, fill = false, className }: {
  children: React.ReactNode; fill?: boolean; className?: string
}): React.JSX.Element {
  return (
    <main
      className={cn(
        'flex flex-col gap-4 p-4 sm:p-5',
        fill && 'h-full overflow-hidden',
        className,
      )}
    >
      {children}
    </main>
  )
}

/** h1 + a quiet subtitle on the same line, actions pushed right. */
export function PageHeader({ title, subtitle, icon: Icon, children }: {
  title: string
  subtitle?: React.ReactNode
  icon?: React.ComponentType<{ className?: string; stroke?: number }>
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {Icon && <Icon className="h-5 w-5 shrink-0 text-brand" stroke={1.75} />}
      <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>
      {subtitle !== undefined && (
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

/** The card surface used everywhere: quiet fill, hairline border. */
export function Panel({ children, className }: {
  children: React.ReactNode; className?: string
}): React.JSX.Element {
  return (
    <div className={cn('rounded-lg border border-border/70 bg-card/40', className)}>
      {children}
    </div>
  )
}

/** Panel with a title row — lists, feeds, tables. */
export function PanelSection({ title, aside, children, className, bodyClassName }: {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}): React.JSX.Element {
  return (
    <Panel className={cn('flex min-h-0 flex-col overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <span className="font-display text-sm font-semibold">{title}</span>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </Panel>
  )
}

/** One KPI: tinted icon, quiet label, big display number. */
export function StatCard({ label, value, icon: Icon, tone = 'brand', hint }: {
  label: string
  value: React.ReactNode
  icon?: React.ComponentType<{ className?: string; stroke?: number }>
  tone?: 'brand' | 'critical' | 'warn' | 'muted'
  hint?: string
}): React.JSX.Element {
  const toneClass = {
    brand: 'text-brand',
    critical: 'text-red-400',
    warn: 'text-amber-400',
    muted: 'text-muted-foreground',
  }[tone]
  return (
    <Panel className="flex flex-col gap-1 p-3" >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className={cn('h-4 w-4 shrink-0', toneClass)} stroke={1.75} />}
        <span className="truncate" title={hint ?? label}>{label}</span>
      </div>
      <div className="font-display text-[22px] font-semibold leading-tight tabular-nums">
        {value}
      </div>
    </Panel>
  )
}

const PILL_TONE: Record<string, string> = {
  online: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  offline: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  error: 'bg-red-500/15 text-red-300 ring-red-500/30',
}

/** Camera status over a video tile — readable on any frame. */
export function StatusPill({ status, label, className }: {
  status: string; label: string; className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-none ring-1',
        PILL_TONE[status] ?? PILL_TONE.offline,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}
