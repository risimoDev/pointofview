'use client'

import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { animate } from 'animejs'

/** Fade-and-rise once the block scrolls into view (anime.js). */
export function Reveal({ children, delay = 0, className }: {
  children: React.ReactNode
  delay?: number
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.opacity = '1'
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        io.disconnect()
        animate(el, {
          opacity: [0, 1], translateY: [26, 0],
          duration: 750, delay, ease: 'outCubic',
        })
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [delay])

  return (
    <div ref={ref} style={{ opacity: 0 }} className={className}>
      {children}
    </div>
  )
}

/** Count-up number that starts when visible. */
export function CountUp({ to, suffix = '', className, decimals = 0 }: {
  to: number
  suffix?: string
  className?: string
  decimals?: number
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const render = (v: number): void => {
      el.textContent = `${v.toFixed(decimals).replace('.', ',')}${suffix}`
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      render(to)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        io.disconnect()
        const state = { v: 0 }
        animate(state, {
          v: to, duration: 1600, ease: 'outExpo',
          onUpdate: () => render(state.v),
        })
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [to, suffix, decimals])

  return <span ref={ref} className={className}>0{suffix}</span>
}
