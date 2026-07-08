'use client'

import type * as React from 'react'
import { use, useCallback, useEffect, useState } from 'react'
import { IconVectorTriangle, IconRefresh } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { ZoneEditor } from '@/components/zone-editor'
import { getSnapshotObjectUrl } from '@/lib/api'

export default function ZonesPage(
  { params }: { params: Promise<{ id: string }> },
): React.JSX.Element {
  const { id } = use(params)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => { setError(false); setAttempt((a) => a + 1) }, [])

  useEffect(() => {
    let active = true
    let url: string | null = null
    getSnapshotObjectUrl(id)
      .then((u) => {
        if (!active) { URL.revokeObjectURL(u); return }
        url = u; setImageUrl(u)
      })
      .catch(() => { if (active) setError(true) })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, attempt])

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <IconVectorTriangle className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Редактор зон</h1>
      </div>
      {error && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border/70 bg-card/40 p-4">
          <p className="text-sm text-destructive">Не удалось получить кадр камеры.</p>
          <p className="text-xs text-muted-foreground">
            Камера может быть не в сети или ещё не зарегистрирована в видеосервере —
            попробуй ещё раз через несколько секунд.
          </p>
          <Button size="sm" variant="outline" onClick={retry}>
            <IconRefresh className="mr-1 h-4 w-4" stroke={1.75} /> Повторить
          </Button>
        </div>
      )}
      {imageUrl
        ? <ZoneEditor cameraId={id} imageUrl={imageUrl} />
        : !error && <p className="text-muted-foreground">Загрузка кадра…</p>}
    </main>
  )
}
