'use client'

import { useEffect, useRef } from 'react'
import { StreamEventSchema, fromStreamEvent } from '@shared/events.schema'
import { getWsTicket } from '@/lib/api'
import { useEventsStore } from '@/store/events.store'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000'
const MAX_BACKOFF = 30_000

/** Live event stream over WebSocket with exponential-backoff reconnect. */
export function useEventStream(): void {
  const addEvent = useEventsStore((s) => s.addEvent)
  const closedRef = useRef(false)

  useEffect(() => {
    closedRef.current = false
    let ws: WebSocket | null = null
    let backoff = 1000
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = async (): Promise<void> => {
      let ticket: string
      try {
        ticket = await getWsTicket() // single-use, 30s TTL
      } catch {
        return // not authenticated
      }
      if (closedRef.current) return

      ws = new WebSocket(`${WS_BASE}/api/v1/ws/events?ticket=${encodeURIComponent(ticket)}`)

      ws.onopen = () => { backoff = 1000 }

      ws.onmessage = (ev: MessageEvent<string>) => {
        const parsed = StreamEventSchema.safeParse(JSON.parse(ev.data))
        if (!parsed.success) return
        const e = fromStreamEvent(parsed.data)
        addEvent(e)
        if (e.severity === 'critical') {
          void new Audio('/alert.mp3').play().catch(() => undefined)
        }
      }

      ws.onclose = () => {
        if (closedRef.current) return
        timer = setTimeout(() => void connect(), backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF)
      }

      ws.onerror = () => ws?.close()
    }

    void connect()

    return () => {
      closedRef.current = true
      if (timer) clearTimeout(timer)
      ws?.close()
    }
  }, [addEvent])
}
