'use client'

import type * as React from 'react'
import { use, useEffect, useState } from 'react'
import { IconVectorTriangle } from '@tabler/icons-react'
import { ZoneEditor } from '@/components/zone-editor'
import { getSnapshotObjectUrl } from '@/lib/api'

export default function ZonesPage(
  { params }: { params: Promise<{ id: string }> },
): React.JSX.Element {
  const { id } = use(params)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let url: string | null = null
    getSnapshotObjectUrl(id)
      .then((u) => { url = u; setImageUrl(u) })
      .catch(() => setError(true))
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [id])

  return (
    <main className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <IconVectorTriangle className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Редактор зон</h1>
      </div>
      {error && <p className="text-destructive">Не удалось получить кадр камеры</p>}
      {imageUrl
        ? <ZoneEditor cameraId={id} imageUrl={imageUrl} />
        : !error && <p className="text-muted-foreground">Загрузка кадра…</p>}
    </main>
  )
}
