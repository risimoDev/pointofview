import { create } from 'zustand'
import type { UiEvent } from '@shared/events.schema'

const MAX_EVENTS = 200

interface EventsState {
  events: UiEvent[]
  alertCount: number
  lastByCamera: Record<string, UiEvent>
  addEvent: (e: UiEvent) => void
  clearEvents: () => void
}

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  alertCount: 0,
  lastByCamera: {},
  addEvent: (e) =>
    set((s) => ({
      events: [e, ...s.events].slice(0, MAX_EVENTS),
      alertCount: e.severity === 'critical' ? s.alertCount + 1 : s.alertCount,
      lastByCamera: { ...s.lastByCamera, [e.cameraId]: e },
    })),
  clearEvents: () => set({ events: [], alertCount: 0, lastByCamera: {} }),
}))
