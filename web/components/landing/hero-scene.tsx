'use client'

import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { animate, createAnimatable, createScope, createTimer, stagger, svg } from 'animejs'

/**
 * «Взгляд камеры», версия 2 — люди как их видит нейросеть.
 *
 * Процедурные скелеты позы (13 суставов): ноги шагают, руки машут в
 * противофазе, частота шага привязана к реальной скорости движения.
 * Каждый актёр живёт по сценарию (вошёл → очередь → стойка → ушёл),
 * глубина сцены — через масштаб/скорость/яркость. Поверх — target-lock
 * рамки, шлейфы траекторий, HUD камеры, параллакс за курсором и
 * реакция на скролл. Всё процедурно: SVG + anime.js, ни одной картинки.
 */

// ── palette ───────────────────────────────────────────────────
const TEAL = 'hsl(172 70% 52%)'
const TEAL_DIM = 'hsl(172 60% 40%)'
const GRAY = 'hsl(215 16% 62%)'
const INK = 'hsl(222 47% 8%)'

// ── floor projection: t=0 near (bottom) … t=1 far (horizon) ───
const Y_NEAR = 505
const Y_FAR = 250
const HORIZON = 208
const yOf = (t: number): number => Y_NEAR - (Y_NEAR - Y_FAR) * t
const scaleOf = (t: number): number => 1.55 - 1.05 * t

// ── skeleton geometry (design units at scale 1) ───────────────
const L = { thigh: 16, shin: 15, torso: 20, upperArm: 11, foreArm: 10, headR: 5.2 }
const GROUND_TO_PELVIS = L.thigh + L.shin

interface Pose {
  // [x, y] pairs relative to the actor's ground point
  head: [number, number]
  joints: [number, number][] // neck, pelvis, kneeL, ankleL, kneeR, ankleR, elbowL, wristL, elbowR, wristR, shoulderL, shoulderR, hipC
  bones: string              // single path `d` for every bone
}

/** Walk/idle pose. phase drives the gait; idle01 blends into standing. */
function pose(phase: number, idle01: number, sway: number): Pose {
  const mix = (walk: number, idle: number): number => walk * (1 - idle01) + idle * idle01

  const bob = mix(1.7 * Math.abs(Math.cos(phase)), 0.6 + 0.4 * Math.sin(sway * 2))
  const px = mix(0, 1.4 * Math.sin(sway)) // idle weight shift
  const pelvis: [number, number] = [px, -GROUND_TO_PELVIS - bob]
  const lean = mix(0.06, 0.01) // slight forward lean while walking
  const neck: [number, number] = [pelvis[0] + Math.sin(lean) * L.torso, pelvis[1] - Math.cos(lean) * L.torso]
  const head: [number, number] = [neck[0] + Math.sin(lean) * (L.headR + 3), neck[1] - Math.cos(lean) * (L.headR + 3)]

  // legs: angle from vertical, + = forward
  const leg = (side: 1 | -1): { knee: [number, number]; ankle: [number, number]; hip: [number, number] } => {
    const p = phase + (side === 1 ? 0 : Math.PI)
    const hipA = mix(0.46 * Math.sin(p), side * 0.045)
    const kneeA = mix(0.75 * Math.max(0, Math.sin(p + 1.1)) + 0.06, 0.06)
    const hip: [number, number] = [pelvis[0] + side * 1.6, pelvis[1] + 1]
    const knee: [number, number] = [hip[0] + Math.sin(hipA) * L.thigh, hip[1] + Math.cos(hipA) * L.thigh]
    const shinA = hipA - kneeA
    const ankle: [number, number] = [knee[0] + Math.sin(shinA) * L.shin, knee[1] + Math.cos(shinA) * L.shin]
    return { hip, knee, ankle }
  }
  // arms: opposite phase to same-side leg
  const arm = (side: 1 | -1): { elbow: [number, number]; wrist: [number, number]; shoulder: [number, number] } => {
    const p = phase + (side === 1 ? Math.PI : 0)
    const shA = mix(0.42 * Math.sin(p), side * 0.06)
    const elA = mix(0.30 + 0.18 * Math.max(0, Math.sin(p + 0.4)), 0.12)
    const shoulder: [number, number] = [neck[0] + side * 3.4, neck[1] + 2]
    const elbow: [number, number] = [shoulder[0] + Math.sin(shA) * L.upperArm, shoulder[1] + Math.cos(shA) * L.upperArm]
    const foreA = shA + elA
    const wrist: [number, number] = [elbow[0] + Math.sin(foreA) * L.foreArm, elbow[1] + Math.cos(foreA) * L.foreArm]
    return { shoulder, elbow, wrist }
  }

  const ll = leg(1); const lr = leg(-1)
  const al = arm(1); const ar = arm(-1)
  const seg = (a: [number, number], b: [number, number]): string =>
    `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`
  const bones = [
    seg(pelvis, neck), seg(neck, head),
    seg(ll.hip, ll.knee), seg(ll.knee, ll.ankle),
    seg(lr.hip, lr.knee), seg(lr.knee, lr.ankle),
    seg(al.shoulder, al.elbow), seg(al.elbow, al.wrist),
    seg(ar.shoulder, ar.elbow), seg(ar.elbow, ar.wrist),
    seg(ll.hip, lr.hip), seg(al.shoulder, ar.shoulder),
  ].join('')

  return {
    head,
    joints: [
      neck, pelvis, ll.knee, ll.ankle, lr.knee, lr.ankle,
      al.elbow, al.wrist, ar.elbow, ar.wrist, al.shoulder, ar.shoulder,
      [(ll.hip[0] + lr.hip[0]) / 2, ll.hip[1]],
    ],
    bones,
  }
}
const JOINT_COUNT = 13

// ── actor scripts ─────────────────────────────────────────────
type Seg =
  | { kind: 'walk'; to: [number, number]; speed?: number; fadeIn?: boolean; fadeOut?: boolean }
  | { kind: 'idle'; dur: number; chip?: boolean }
  | { kind: 'gone'; dur: number }

interface ActorCfg {
  id: string
  staff?: boolean
  start: [number, number] // [x, t]
  segs: Seg[]
  startDelay: number
  trkId: string
}

const ACTORS: ActorCfg[] = [
  {
    id: 'a', trkId: 'TRK 012', start: [-70, 0.30], startDelay: 0,
    segs: [
      { kind: 'walk', to: [360, 0.42], fadeIn: true },
      { kind: 'idle', dur: 3200, chip: true },
      { kind: 'walk', to: [470, 0.50] },
      { kind: 'idle', dur: 2600 },
      { kind: 'walk', to: [640, 0.60] },
      { kind: 'idle', dur: 3400 },
      { kind: 'walk', to: [1040, 0.46], fadeOut: true },
      { kind: 'gone', dur: 2800 },
    ],
  },
  {
    id: 'b', trkId: 'TRK 013', start: [1040, 0.66], startDelay: 5200,
    segs: [
      { kind: 'walk', to: [560, 0.55], fadeIn: true },
      { kind: 'idle', dur: 2400 },
      { kind: 'walk', to: [430, 0.44], },
      { kind: 'idle', dur: 4200, chip: true },
      { kind: 'walk', to: [230, 0.34] },
      { kind: 'idle', dur: 1600 },
      { kind: 'walk', to: [-80, 0.30], fadeOut: true },
      { kind: 'gone', dur: 4200 },
    ],
  },
  {
    id: 'c', trkId: 'TRK 002', staff: true, start: [760, 0.78], startDelay: 1000,
    segs: [
      { kind: 'idle', dur: 5200 },
      { kind: 'walk', to: [680, 0.78], speed: 30 },
      { kind: 'idle', dur: 4200 },
      { kind: 'walk', to: [810, 0.78], speed: 30 },
    ],
  },
]

// runtime state per actor
interface ActorState {
  cfg: ActorCfg
  x: number
  t: number
  facing: 1 | -1
  phase: number
  idle01: number
  segIdx: number
  segElapsed: number
  segFrom: [number, number]
  segLen: number
  waiting: number // startDelay countdown
  visible: boolean
  conf: number
  trail: number[][]
  el: {
    root: SVGGElement
    bones: SVGPathElement
    head: SVGCircleElement
    joints: SVGCircleElement[]
    bbox: SVGGElement
    conf: SVGTextElement
    trail: SVGPolylineElement
  }
}

const BASE_SPEED = 62 // px/s at scale 1
const STEP_LEN = 12.5 // px of travel per half stride at scale 1

// ── static scenery ────────────────────────────────────────────
function gridLines(): { x1: number; y1: number; x2: number; y2: number; o: number }[] {
  const VP: [number, number] = [480, 96]
  const out: { x1: number; y1: number; x2: number; y2: number; o: number }[] = []
  for (const x of [-220, -60, 100, 260, 420, 580, 740, 900, 1060, 1220]) {
    const t = (540 - HORIZON) / (540 - VP[1])
    out.push({ x1: x, y1: 540, x2: x + (VP[0] - x) * t, y2: HORIZON, o: 0.10 })
  }
  for (const t of [0.02, 0.14, 0.28, 0.44, 0.62, 0.82]) {
    out.push({ x1: 0, y1: yOf(t) + 20, x2: 960, y2: yOf(t) + 20, o: 0.14 - t * 0.09 })
  }
  return out
}

/** ПВЗ hint: стеллаж с ячейками на задней стене (композиция уточнится по
 *  реальному кадру точки). */
function Shelves(): React.JSX.Element {
  const rows = 3; const cols = 7
  const x0 = 570; const y0 = 118; const w = 350; const h = 86
  const cells: React.JSX.Element[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={x0 + 4 + c * (w / cols)} y={y0 + 4 + r * (h / rows)}
          width={w / cols - 8} height={h / rows - 8} rx="1.5"
          fill="hsl(217 19% 14% / 0.5)" stroke="hsl(215 16% 60% / 0.14)" strokeWidth="1"
        />,
      )
    }
  }
  return (
    <g>
      <rect x={x0} y={y0} width={w} height={h} rx="2" fill="none" stroke="hsl(215 16% 60% / 0.22)" strokeWidth="1" />
      {cells}
      <text x={x0} y={y0 - 7} fontSize="9" fontFamily="ui-monospace, monospace" fill="hsl(215 16% 60% / 0.45)">
        стеллаж · ячейки
      </text>
    </g>
  )
}

function ActorNode({ cfg }: { cfg: ActorCfg }): React.JSX.Element {
  const color = cfg.staff ? GRAY : TEAL
  const dim = cfg.staff ? 'hsl(215 16% 62% / 0.35)' : 'hsl(172 70% 52% / 0.45)'
  return (
    <g className={`actor actor-${cfg.id}`} opacity="0">
      <g className="skel">
        <path className="bones-glow" d="" fill="none" stroke={dim} strokeWidth="4.5" strokeLinecap="round" />
        <path className="bones" d="" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        <circle className="head" r={L.headR} fill="none" stroke={color} strokeWidth="1.7" />
        {Array.from({ length: JOINT_COUNT }).map((_, i) => (
          <circle key={i} className="joint" r="1.9" fill={color} />
        ))}
      </g>
      {/* target-lock brackets + label; local coords scale with the actor */}
      <g className="bbox">
        <g stroke={cfg.staff ? 'hsl(215 16% 62% / 0.75)' : TEAL} strokeWidth="1.4" fill="none">
          <path d="M -21 -76 h 7 M -21 -76 v 7" />
          <path d="M 21 -76 h -7 M 21 -76 v 7" />
          <path d="M -21 6 h 7 M -21 6 v -7" />
          <path d="M 21 6 h -7 M 21 6 v -7" />
        </g>
        <rect x="-21" y="-90" width={cfg.staff ? 74 : 96} height="12" rx="1.5" fill={cfg.staff ? 'hsl(215 16% 40%)' : TEAL} opacity="0.95" />
        <text
          className="conf" x="-17" y="-80.8" fontSize="8" fontWeight="600"
          fontFamily="ui-monospace, monospace" fill={INK}
        >
          {cfg.staff ? `${cfg.trkId} сотрудник` : `${cfg.trkId} человек 0.93`}
        </text>
      </g>
    </g>
  )
}

// smoothed cursor/scroll followers
interface Follower { translateX: (v: number) => void; translateY: (v: number) => void }

export function HeroScene({ className }: { className?: string }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // collect element refs per actor
    const states: ActorState[] = []
    for (const cfg of ACTORS) {
      const g = root.querySelector<SVGGElement>(`.actor-${cfg.id}`)
      const trail = root.querySelector<SVGPolylineElement>(`.trail-${cfg.id}`)
      if (!g || !trail) continue
      states.push({
        cfg,
        x: cfg.start[0], t: cfg.start[1], facing: 1,
        phase: Math.random() * Math.PI * 2, idle01: 1,
        segIdx: -1, segElapsed: 0, segFrom: [cfg.start[0], cfg.start[1]], segLen: 0,
        waiting: cfg.startDelay, visible: false,
        conf: 0.9, trail: [],
        el: {
          root: g,
          bones: g.querySelector('.bones') as SVGPathElement,
          head: g.querySelector('.head') as SVGCircleElement,
          joints: Array.from(g.querySelectorAll<SVGCircleElement>('.joint')),
          bbox: g.querySelector('.bbox') as SVGGElement,
          conf: g.querySelector('.conf') as SVGTextElement,
          trail,
        },
      })
    }
    const bonesGlow = new Map<string, SVGPathElement>()
    for (const s of states) {
      const el = s.el.root.querySelector<SVGPathElement>('.bones-glow')
      if (el) bonesGlow.set(s.cfg.id, el)
    }

    const draw = (s: ActorState, dtMs: number): void => {
      const sc = scaleOf(s.t)
      const p = pose(s.phase, s.idle01, performance.now() / 1000 + s.cfg.startDelay)
      s.el.root.setAttribute(
        'transform',
        `translate(${s.x.toFixed(1)} ${yOf(s.t).toFixed(1)}) scale(${sc.toFixed(3)})`,
      )
      const flip = `scale(${s.facing} 1)`
      s.el.bones.setAttribute('transform', flip)
      bonesGlow.get(s.cfg.id)?.setAttribute('transform', flip)
      s.el.bones.setAttribute('d', p.bones)
      bonesGlow.get(s.cfg.id)?.setAttribute('d', p.bones)
      s.el.head.setAttribute('transform', flip)
      s.el.head.setAttribute('cx', String(p.head[0]))
      s.el.head.setAttribute('cy', String(p.head[1]))
      for (let i = 0; i < s.el.joints.length; i++) {
        const j = p.joints[i]
        if (!j) continue
        const el = s.el.joints[i]!
        el.setAttribute('transform', flip)
        el.setAttribute('cx', String(j[0]))
        el.setAttribute('cy', String(j[1]))
      }
      // confidence: slow random walk, dips while far away
      if (!s.cfg.staff) {
        s.conf += (Math.random() - 0.5) * 0.004 * dtMs
        const lo = 0.82 - s.t * 0.06
        s.conf = Math.min(0.98, Math.max(lo, s.conf))
        s.el.conf.textContent = `${s.cfg.trkId} человек ${s.conf.toFixed(2)}`
      }
    }

    if (reduced) {
      // static frame: actors posed mid-scene, no loops or listeners
      for (const s of states) {
        s.idle01 = s.cfg.staff ? 1 : 0
        s.phase = 2.1
        s.el.root.setAttribute('opacity', '1')
        draw(s, 0)
      }
      return
    }

    let chipBusy = false
    const showChip = (): void => {
      if (chipBusy) return
      chipBusy = true
      animate('.event-chip', {
        opacity: [0, 1], translateY: [10, 0], duration: 450, ease: 'outCubic',
        onComplete: () => {
          animate('.event-chip', {
            opacity: 0, translateY: -8, duration: 450, delay: 2600, ease: 'inCubic',
            onComplete: () => { chipBusy = false },
          })
        },
      })
    }

    const lockOn = (s: ActorState): void => {
      animate(s.el.bbox, {
        opacity: [0, 1], scale: [1.7, 1], duration: 550, ease: 'outCubic',
      })
    }

    const beginSeg = (s: ActorState): void => {
      s.segIdx = (s.segIdx + 1) % s.cfg.segs.length
      s.segElapsed = 0
      s.segFrom = [s.x, s.t]
      const seg = s.cfg.segs[s.segIdx]!
      if (seg.kind === 'walk') {
        const dx = seg.to[0] - s.x
        const dyT = (seg.to[1] - s.t) * (Y_NEAR - Y_FAR)
        s.segLen = Math.hypot(dx, dyT)
        if (Math.abs(dx) > 12) s.facing = dx >= 0 ? 1 : -1
        if (seg.fadeIn) {
          s.visible = true
          animate(s.el.root, { opacity: [0, 1], duration: 600, ease: 'linear' })
          lockOn(s)
        }
        if (seg.fadeOut) {
          const ms = (s.segLen / (BASE_SPEED * scaleOf(s.t))) * 1000
          animate(s.el.root, { opacity: 0, duration: 500, delay: Math.max(0, ms - 500), ease: 'linear' })
        }
      } else if (seg.kind === 'gone') {
        s.visible = false
      } else if (seg.chip) {
        showChip()
      }
    }

    const occEl = root.querySelector('.hud-occ')
    let lastOcc = -1

    const step = (rawDt: number): void => {
      // anime's Timer can report a bogus deltaTime on the very first tick
      // (huge/negative) — clamp hard or one frame catapults the integration
      const dtMs = Number.isFinite(rawDt) ? Math.min(Math.max(rawDt, 0), 66) : 16
      const dt = dtMs / 1000
      let occ = 0
      for (const s of states) {
        if (s.waiting > 0) {
          s.waiting -= dtMs
          continue
        }
        if (s.segIdx === -1) {
          s.visible = !s.cfg.segs.some((g) => g.kind === 'walk' && g.fadeIn)
          if (s.visible) {
            s.el.root.setAttribute('opacity', '1')
            lockOn(s)
          }
          beginSeg(s)
        }
        const seg = s.cfg.segs[s.segIdx]!
        if (seg.kind === 'walk') {
          const speed = (seg.speed ?? BASE_SPEED) * scaleOf(s.t)
          const remain = ((): number => {
            const dx = seg.to[0] - s.x
            const dyT = (seg.to[1] - s.t) * (Y_NEAR - Y_FAR)
            return Math.hypot(dx, dyT)
          })()
          const move = Math.min(speed * dt, remain)
          if (remain > 0.5) {
            const k = move / remain
            s.x += (seg.to[0] - s.x) * k
            s.t += (seg.to[1] - s.t) * k
            s.phase += (move / (STEP_LEN * scaleOf(s.t))) * Math.PI * 0.5
            s.idle01 = Math.max(0, s.idle01 - dt * 4)
          }
          if (remain - move < 0.6) beginSeg(s)
        } else if (seg.kind === 'idle') {
          s.idle01 = Math.min(1, s.idle01 + dt * 3)
          s.segElapsed += dtMs
          if (s.segElapsed >= seg.dur) beginSeg(s)
        } else {
          s.segElapsed += dtMs
          if (s.segElapsed >= seg.dur) {
            s.x = s.cfg.start[0]; s.t = s.cfg.start[1]
            s.trail = []
            s.el.trail.setAttribute('points', '')
            beginSeg(s)
          }
        }

        if (s.visible || Number(s.el.root.getAttribute('opacity')) > 0) {
          draw(s, dtMs)
          if (s.visible && !s.cfg.staff) occ++
          // trail: ground positions, thinned
          if (s.visible && (s.trail.length === 0
            || Math.hypot(s.x - s.trail[s.trail.length - 1]![0]!, yOf(s.t) - s.trail[s.trail.length - 1]![1]!) > 9)) {
            s.trail.push([s.x, yOf(s.t)])
            if (s.trail.length > 34) s.trail.shift()
            s.el.trail.setAttribute('points', s.trail.map((pt) => `${pt[0]!.toFixed(0)},${pt[1]!.toFixed(0)}`).join(' '))
          }
        }
      }
      if (occ !== lastOcc && occEl) {
        lastOcc = occ
        occEl.textContent = `в кадре: ${occ} · сотрудников: 1`
      }
    }

    // ── build everything inside one revertable scope ──────────
    const scope = createScope({ root }).add(() => {
      animate(svg.createDrawable('.grid line'), {
        draw: '0 1', duration: 1300, delay: stagger(28), ease: 'inOutQuad',
      })
      animate('.zone-shape', {
        opacity: [0.5, 1], duration: 2800, loop: true, alternate: true, ease: 'inOutSine',
      })
      animate('.scanline', { translateY: [0, 540], duration: 9000, loop: true, ease: 'linear' })
      animate('.rec-dot', { opacity: [1, 0.15], duration: 850, loop: true, alternate: true, ease: 'inOutSine' })
      animate('.noise', { opacity: [0.015, 0.05], duration: 420, loop: true, alternate: true, ease: 'linear' })
      createTimer({ onUpdate: (self) => step(self.deltaTime) })
    })

    // ── cursor parallax: layers drift with different depth ────
    const backFollow = createAnimatable('.layer-back', {
      translateX: 500, translateY: 500, ease: 'out(3)',
    }) as unknown as Follower
    const sceneFollow = createAnimatable('.layer-scene', {
      translateX: 500, translateY: 500, ease: 'out(3)',
    }) as unknown as Follower
    const onMouse = (e: MouseEvent): void => {
      if (window.scrollY > window.innerHeight) return
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      backFollow.translateX(nx * -7); backFollow.translateY(ny * -4)
      sceneFollow.translateX(nx * -16); sceneFollow.translateY(ny * -9)
    }
    window.addEventListener('mousemove', onMouse, { passive: true })

    // ── scroll reaction: hero recedes as you scroll past it ───
    const svgEl = root.querySelector('svg')
    let scrollRaf = 0
    const onScrollFn = (): void => {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = requestAnimationFrame(() => {
        if (!svgEl) return
        const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.85)))
        svgEl.style.transform = `translateY(${p * 60}px) scale(${1 + p * 0.07})`
        svgEl.style.opacity = String(1 - p * 0.95)
      })
    }
    window.addEventListener('scroll', onScrollFn, { passive: true })

    // clock
    const clockEl = root.querySelector('.hud-clock')
    const tick = (): void => {
      if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('ru-RU', { hour12: false })
    }
    tick()
    const clock = setInterval(tick, 1000)

    return () => {
      clearInterval(clock)
      cancelAnimationFrame(scrollRaf)
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('scroll', onScrollFn)
      scope.revert()
    }
  }, [])

  return (
    <div ref={rootRef} className={className} aria-hidden="true" style={{ perspective: '1200px' }}>
      <svg
        viewBox="0 0 960 540" className="h-full w-full will-change-transform"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="hero-glow" cx="50%" cy="32%" r="72%">
            <stop offset="0%" stopColor="hsl(172 70% 47% / 0.09)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(222 26% 7%)" stopOpacity="0" />
            <stop offset="100%" stopColor="hsl(222 26% 7%)" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="vignette" cx="50%" cy="46%" r="72%">
            <stop offset="62%" stopColor="transparent" />
            <stop offset="100%" stopColor="hsl(222 30% 4% / 0.55)" />
          </radialGradient>
        </defs>

        <rect width="960" height="540" fill="url(#hero-glow)" />

        {/* back layer: architecture + floor (weak parallax) */}
        <g className="layer-back">
          <line x1="0" y1={HORIZON} x2="960" y2={HORIZON} stroke="hsl(172 70% 47% / 0.20)" strokeWidth="1" />
          <Shelves />
          {/* дверь */}
          <g>
            <rect x="64" y="120" width="58" height="88" rx="2" fill="none" stroke="hsl(215 16% 60% / 0.2)" strokeWidth="1" />
            <text x="64" y="113" fontSize="9" fontFamily="ui-monospace, monospace" fill="hsl(215 16% 60% / 0.45)">вход</text>
          </g>
          <g className="grid" strokeWidth="1">
            {gridLines().map((l, i) => (
              <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={`hsl(172 70% 47% / ${l.o})`} />
            ))}
          </g>
        </g>

        {/* scene layer: zone, desk, trails, actors (stronger parallax) */}
        <g className="layer-scene">
          <g className="zone-shape">
            <polygon
              points="300,470 620,470 552,330 350,330"
              fill="hsl(172 70% 47% / 0.05)" stroke="hsl(172 70% 47% / 0.5)"
              strokeWidth="1.2" strokeDasharray="8 5"
            />
            <text x="312" y="458" fontSize="11" fontFamily="ui-monospace, monospace" fill="hsl(172 70% 47% / 0.8)">
              зона: очередь
            </text>
          </g>

          {/* стойка выдачи */}
          <g>
            <rect x="640" y="288" width="240" height="14" rx="2" fill="hsl(217 19% 22% / 0.9)" />
            <rect x="646" y="302" width="228" height="30" rx="1" fill="hsl(217 19% 13% / 0.85)" stroke="hsl(215 16% 60% / 0.2)" strokeWidth="1" />
            <text x="652" y="322" fontSize="10" fontFamily="ui-monospace, monospace" fill="hsl(215 16% 60% / 0.7)">
              стойка выдачи
            </text>
          </g>

          {ACTORS.map((a) => (
            <polyline
              key={a.id} className={`trail-${a.id}`} points="" fill="none"
              stroke={a.staff ? 'hsl(215 16% 62% / 0.16)' : 'hsl(172 70% 52% / 0.22)'}
              strokeWidth="1.5" strokeDasharray="1 6" strokeLinecap="round"
            />
          ))}
          {ACTORS.map((a) => <ActorNode key={a.id} cfg={a} />)}

          <g className="event-chip" opacity="0">
            <rect x="332" y="240" width="196" height="30" rx="6" fill="hsl(222 24% 9% / 0.94)" stroke="hsl(172 70% 47% / 0.55)" strokeWidth="1" />
            <circle cx="348" cy="255" r="3.5" fill={TEAL} />
            <text x="360" y="259" fontSize="11.5" fontFamily="ui-monospace, monospace" fill="hsl(210 22% 92%)">
              вход в зону · очередь
            </text>
          </g>
        </g>

        {/* camera treatment */}
        <rect width="960" height="540" fill="url(#vignette)" />
        <rect className="noise" width="960" height="540" fill={TEAL_DIM} opacity="0.02" style={{ mixBlendMode: 'overlay' }} />
        <rect className="scanline" x="0" y="-2" width="960" height="2" fill="hsl(172 70% 47% / 0.06)" />

        {/* HUD */}
        {/* HUD (top row pushed below the fixed site header) */}
        <g fontFamily="ui-monospace, monospace" fontSize="11">
          <circle className="rec-dot" cx="26" cy="72" r="4.5" fill="hsl(0 72% 51%)" />
          <text x="38" y="76" fill="hsl(210 22% 92% / 0.85)">REC · камера 2 · зал</text>
          <text className="hud-clock" x="934" y="76" textAnchor="end" fill="hsl(210 22% 92% / 0.7)">00:00:00</text>
          <text className="hud-occ" x="26" y="522" fill="hsl(172 70% 47% / 0.9)">в кадре: 0 · сотрудников: 1</text>
          <text x="934" y="522" textAnchor="end" fill="hsl(215 16% 60% / 0.7)">AI-анализ · поза · трекинг · 12 к/с</text>
        </g>

        <g stroke="hsl(172 70% 47% / 0.5)" strokeWidth="2" fill="none">
          <path d="M 10 92 V 58 H 44" />
          <path d="M 916 58 H 950 V 92" />
          <path d="M 950 494 V 528 H 916" />
          <path d="M 44 528 H 10 V 494" />
        </g>

        <rect x="0" y="440" width="960" height="100" fill="url(#hero-fade)" />
      </svg>
    </div>
  )
}
