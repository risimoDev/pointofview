'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import { IconSun, IconMoon } from '@tabler/icons-react'

type Theme = 'dark' | 'light'

function apply(theme: Theme): void {
  const d = document.documentElement
  d.classList.remove('light', 'dark')
  d.classList.add(theme)
}

/** Dark is the product default; light is opt-in. The pre-hydration script in
 *  the root layout applies the stored theme before paint, this only flips it. */
export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') setTheme(stored)
  }, [])

  const toggle = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    apply(next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      /* private mode — ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Переключить тему"
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {theme === 'dark'
        ? <IconSun className="h-[18px] w-[18px]" stroke={1.75} />
        : <IconMoon className="h-[18px] w-[18px]" stroke={1.75} />}
    </button>
  )
}
