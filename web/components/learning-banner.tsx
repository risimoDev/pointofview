'use client'

import type * as React from 'react'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { IconSchool } from '@tabler/icons-react'
import { getOrgStatus } from '@/lib/api'

/** Says out loud that notifications are being held back.
 *
 *  Without it learning mode is indistinguishable from a broken installation:
 *  events appear in the journal, nothing arrives in Telegram, and the natural
 *  conclusion is that the alerts are broken. Visible to every signed-in user,
 *  not only to whoever can change the setting. */
export function LearningBanner(): React.JSX.Element | null {
  const pathname = usePathname()
  const [until, setUntil] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getOrgStatus()
      .then((s) => { if (active) setUntil(s.learning_until) })
      .catch(() => { if (active) setUntil(null) })
    return () => { active = false }
  }, [pathname])

  if (!until) return null
  const date = new Date(until)
  if (!Number.isFinite(date.getTime())) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
      <IconSchool className="h-4 w-4 shrink-0" stroke={1.75} />
      <span>
        <b>Учебный режим</b> до{' '}
        {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(date)}.
        События пишутся в журнал, оповещения наружу не отправляются (кроме «камера не в сети»).
      </span>
    </div>
  )
}
