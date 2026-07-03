'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getClipUrl, requestClip } from '@/lib/api'

export type ClipStatus = 'idle' | 'processing' | 'ready' | 'error'

interface ClipState {
  status: ClipStatus
  url?: string
}

const POLL_MS = 2000

export function useClipRequest(eventId: string): ClipState & { request: () => void } {
  const [state, setState] = useState<ClipState>({ status: 'idle' })
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = undefined
  }, [])

  const request = useCallback(() => {
    setState({ status: 'processing' })
    requestClip(eventId)
      .then(() => {
        stop()
        timer.current = setInterval(() => {
          getClipUrl(eventId)
            .then((url) => {
              if (url) {
                stop()
                setState({ status: 'ready', url })
              }
            })
            .catch(() => { stop(); setState({ status: 'error' }) })
        }, POLL_MS)
      })
      .catch(() => setState({ status: 'error' }))
  }, [eventId, stop])

  useEffect(() => stop, [stop])

  return { ...state, request }
}
