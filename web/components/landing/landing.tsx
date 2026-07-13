'use client'

import type * as React from 'react'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { animate, createScope, stagger, svg } from 'animejs'
import {
  IconShieldCheck, IconVideo, IconUsersGroup, IconClockHour4,
  IconBellRinging, IconPolygon, IconHistory, IconDeviceCctv, IconLock,
  IconCpu, IconBrandTelegram, IconShieldLock, IconServer2, IconListDetails,
  IconArrowDown,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { HeroScene } from './hero-scene'
import { Reveal, CountUp } from './reveal'
import { DemoForm } from './demo-form'

// ── header ────────────────────────────────────────────────────
function Header(): React.JSX.Element {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/50">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <a href="#top" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/30">
            <IconShieldCheck className="h-4 w-4" stroke={1.9} />
          </span>
          <span className="font-display text-base font-semibold tracking-tight">
            BZK-VIZI<span className="text-brand">AI</span>
          </span>
        </a>
        <nav className="ml-auto hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">Возможности</a>
          <a href="#how" className="transition-colors hover:text-foreground">Как работает</a>
          <a href="#who" className="transition-colors hover:text-foreground">Для кого</a>
          <a href="#demo" className="transition-colors hover:text-foreground">Демо</a>
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Button asChild size="sm" variant="outline">
            <Link href="/login">Войти</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <a href="#demo">Запросить демо</a>
          </Button>
        </div>
      </div>
    </header>
  )
}

// ── hero ──────────────────────────────────────────────────────
const H1_WORDS = ['Камеры', 'вашего', 'ПВЗ', 'начинают', 'думать']

function Hero(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const el of root.querySelectorAll<HTMLElement>('.h1-word, .hero-fade')) {
        el.style.opacity = '1'
      }
      return
    }
    const scope = createScope({ root }).add(() => {
      animate('.h1-word', {
        opacity: [0, 1], translateY: [26, 0],
        duration: 800, delay: stagger(90, { start: 150 }), ease: 'outCubic',
      })
      animate('.hero-fade', {
        opacity: [0, 1], translateY: [18, 0],
        duration: 800, delay: stagger(140, { start: 650 }), ease: 'outCubic',
      })
    })
    return () => scope.revert()
  }, [])

  return (
    <section id="top" ref={ref} className="relative overflow-hidden pt-14">
      <HeroScene className="pointer-events-none absolute inset-0 opacity-90" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/75 to-background/20" />

      <div className="relative mx-auto flex max-w-6xl flex-col justify-center px-4 py-24 sm:py-32 lg:min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-2xl">
          <div className="hero-fade mb-5 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-brand opacity-0">
            <IconDeviceCctv className="h-3.5 w-3.5" stroke={1.75} />
            Видеоаналитика для пунктов выдачи — и не только
          </div>

          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            {H1_WORDS.map((w, i) => (
              <span key={i}>
                <span className="h1-word inline-block opacity-0">
                  {i === H1_WORDS.length - 1 ? <span className="text-brand">{w}</span> : w}
                </span>
                {i < H1_WORDS.length - 1 ? ' ' : null}
              </span>
            ))}
          </h1>

          <p className="hero-fade mt-6 max-w-xl text-base leading-relaxed text-muted-foreground opacity-0 sm:text-lg">
            Платформа подключается к обычным камерам точки: считает посетителей
            без двойного счёта, следит за очередью, пишет архив и присылает
            алерты в Telegram — от «камера отключилась» до «у стойки очередь».
          </p>

          <div className="hero-fade mt-8 flex flex-wrap items-center gap-3 opacity-0">
            <Button asChild size="lg">
              <a href="#demo">Запросить демо</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#how">
                Как это работает
                <IconArrowDown className="ml-2 h-4 w-4" stroke={1.75} />
              </a>
            </Button>
          </div>

          <div className="hero-fade mt-12 grid max-w-lg grid-cols-3 gap-6 opacity-0">
            <div>
              <div className="font-display text-2xl font-semibold tabular-nums text-brand sm:text-3xl">
                <CountUp to={3} suffix=" с" />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">задержка живого видео</div>
            </div>
            <div>
              <div className="font-display text-2xl font-semibold tabular-nums text-brand sm:text-3xl">24/7</div>
              <div className="mt-1 text-xs text-muted-foreground">запись в архив с автоочисткой</div>
            </div>
            <div>
              <div className="font-display text-2xl font-semibold tabular-nums text-brand sm:text-3xl">
                <CountUp to={0} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">биометрии — без рисков 152-ФЗ</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── features ──────────────────────────────────────────────────
const FEATURES = [
  {
    icon: IconVideo, title: 'Живое видео в браузере',
    text: 'Все камеры точки на одном экране с задержкой 1–3 секунды. Ничего не нужно устанавливать — открыл сайт и смотришь.',
  },
  {
    icon: IconUsersGroup, title: 'Честный подсчёт посетителей',
    text: 'Сквозная идентификация «склеивает» человека между камерами: один посетитель — один в статистике. Сотрудники не считаются.',
  },
  {
    icon: IconClockHour4, title: 'Очередь под контролем',
    text: 'Система видит, сколько людей ждёт и как долго. Очередь выросла выше порога — вам мгновенно приходит уведомление.',
  },
  {
    icon: IconBellRinging, title: 'Алерты в Telegram',
    text: 'Камера отключилась, человек в запретной зоне, скопление людей — вы узнаёте сразу, вместе с кадром события.',
  },
  {
    icon: IconPolygon, title: 'Зоны и правила',
    text: 'Нарисуйте зону прямо на кадре: стойка выдачи, полки, запретная зона. Каждой зоне — свои правила и расписание.',
  },
  {
    icon: IconHistory, title: 'Архив и клипы',
    text: 'Круглосуточная запись с автоматической очисткой. К каждому событию — скриншот и видеоклип, готовые для разбора спора.',
  },
]

function Features(): React.JSX.Element {
  return (
    <section id="features" className="relative scroll-mt-16">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <Reveal>
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Не просто камеры — <span className="text-brand">система, которая смотрит за вас</span>
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Обычное видеонаблюдение полезно только после происшествия.
            Здесь события находят вас сами — в момент, когда ещё можно успеть отреагировать.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 90}>
              <div className="group h-full rounded-xl border border-border/70 bg-card/40 p-6 transition-colors hover:border-brand/40 hover:bg-card/70">
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/25 transition-transform group-hover:scale-110">
                  <f.icon className="h-5 w-5" stroke={1.75} />
                </span>
                <h3 className="font-display text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── how it works ──────────────────────────────────────────────
const STEPS = [
  {
    icon: IconDeviceCctv, title: 'Ваши камеры',
    text: 'Подходят обычные IP-камеры, которые уже висят на точке. Ничего менять не нужно.',
  },
  {
    icon: IconLock, title: 'Защищённый туннель',
    text: 'Точка подключается к серверу по шифрованному VPN. Порты наружу не открываются.',
  },
  {
    icon: IconCpu, title: 'ИИ-анализ',
    text: 'Нейросеть на GPU-сервере распознаёт людей и события в реальном времени, кадр за кадром.',
  },
  {
    icon: IconBrandTelegram, title: 'Результат у вас',
    text: 'Дашборд в браузере и алерты в Telegram. Подключение точки занимает меньше часа.',
  },
]

function HowItWorks(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        io.disconnect()
        const line = root.querySelector<SVGPathElement>('.pipe-line')
        if (line) {
          animate(svg.createDrawable(line), { draw: '0 1', duration: 1800, ease: 'inOutQuad' })
        }
      },
      { threshold: 0.3 },
    )
    io.observe(root)
    return () => io.disconnect()
  }, [])

  return (
    <section id="how" ref={ref} className="relative scroll-mt-16 border-y border-border/50 bg-card/20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <Reveal>
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            От камеры до алерта — <span className="text-brand">четыре шага</span>
          </h2>
        </Reveal>
        <div className="relative mt-14">
          {/* connecting line drawn on scroll (desktop) */}
          <svg
            className="pointer-events-none absolute left-0 top-5 hidden h-2 w-full lg:block"
            viewBox="0 0 1000 8" preserveAspectRatio="none" aria-hidden="true"
          >
            <path
              className="pipe-line" d="M 40 4 H 960" fill="none"
              stroke="hsl(172 70% 47% / 0.5)" strokeWidth="2" strokeDasharray="6 6"
            />
          </svg>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 160}>
                <div className="relative">
                  <span className="relative z-10 mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-brand/40 bg-background text-brand">
                    <s.icon className="h-5 w-5" stroke={1.75} />
                  </span>
                  <div className="mb-1 text-xs font-medium text-brand">Шаг {i + 1}</div>
                  <h3 className="font-display text-base font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── analytics mockup ──────────────────────────────────────────
const BARS = [22, 34, 28, 46, 58, 72, 64, 88, 96, 78, 62, 84, 70, 44]

function AnalyticsMock(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const el of root.querySelectorAll<SVGRectElement>('.mock-bar')) {
        el.style.transform = 'scaleY(1)'
      }
      return
    }
    let revert = (): void => { /* nothing animated yet */ }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        io.disconnect()
        const scope = createScope({ root }).add(() => {
          animate('.mock-bar', {
            scaleY: [0, 1], duration: 900,
            delay: stagger(55), ease: 'outCubic',
          })
        })
        revert = () => scope.revert()
      },
      { threshold: 0.35 },
    )
    io.observe(root)
    return () => { io.disconnect(); revert() }
  }, [])

  return (
    <div ref={ref} className="rounded-xl border border-border/70 bg-card/50 p-5 shadow-2xl shadow-brand/5">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-display text-sm font-semibold">Посетители по часам</span>
        <span className="rounded-md border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">сегодня</span>
      </div>
      <svg viewBox="0 0 420 140" className="w-full" aria-hidden="true">
        {BARS.map((h, i) => (
          <rect
            key={i} className="mock-bar"
            x={10 + i * 29} y={130 - h} width="18" height={h} rx="3"
            fill={i === 8 ? 'hsl(172 70% 47%)' : 'hsl(172 40% 34%)'}
            style={{ transformOrigin: `${19 + i * 29}px 130px`, transform: 'scaleY(0)' }}
          />
        ))}
        <line x1="6" y1="130" x2="414" y2="130" stroke="hsl(217 19% 22%)" strokeWidth="1" />
      </svg>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">посетителей</div>
          <div className="font-display text-lg font-semibold tabular-nums"><CountUp to={128} /></div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">пик</div>
          <div className="font-display text-lg font-semibold tabular-nums">14:00</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
          <div className="text-[11px] text-muted-foreground">ожидание, мин</div>
          <div className="font-display text-lg font-semibold tabular-nums"><CountUp to={2.4} decimals={1} /></div>
        </div>
      </div>
    </div>
  )
}

function Analytics(): React.JSX.Element {
  return (
    <section className="relative">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:py-28 lg:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Цифры вместо <span className="text-brand">ощущений</span>
          </h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Сколько людей приходит на точку и в какие часы? Сколько они ждут в
            очереди? Когда нужен второй сотрудник? Аналитика собирается сама,
            пока камеры просто висят на своих местах.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
            {[
              'Посетители по дням и часам — с дедупликацией между камерами',
              'Время ожидания в очереди и время обслуживания у стойки',
              'Все события с кадрами: что, где и когда произошло',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <IconListDetails className="mt-0.5 h-4 w-4 shrink-0 text-brand" stroke={1.75} />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={150}>
          <AnalyticsMock />
        </Reveal>
      </div>
    </section>
  )
}

// ── audiences ─────────────────────────────────────────────────
const AUDIENCES = [
  {
    title: 'Пункты выдачи заказов', ready: true,
    text: 'Очереди, честный счёт посетителей, контроль перепаковки на стойке, споры с клиентами — разобраны по кадрам.',
  },
  {
    title: 'Производство', ready: false,
    text: 'Запретные зоны у станков, контроль СИЗ, ночная охрана периметра. Работает в изолированной сети (on-premise).',
  },
  {
    title: 'Ритейл', ready: false,
    text: 'Посетители и конверсия, контроль выкладки на полках, скопления у касс.',
  },
  {
    title: 'Офисы и склады', ready: false,
    text: 'Человек в помещении в нерабочее время — критический алерт с кадром за секунды.',
  },
]

function Audiences(): React.JSX.Element {
  return (
    <section id="who" className="scroll-mt-16 border-y border-border/50 bg-card/20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
        <Reveal>
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Сделано для ПВЗ. <span className="text-muted-foreground">Растёт дальше.</span>
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.title} delay={i * 100}>
              <div className="h-full rounded-xl border border-border/70 bg-card/40 p-6">
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-base font-semibold">{a.title}</h3>
                  <span className={a.ready
                    ? 'rounded-full bg-brand/15 px-2.5 py-0.5 text-[11px] font-medium text-brand'
                    : 'rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground'}
                  >
                    {a.ready ? 'работает на живых точках' : 'развивается'}
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{a.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── trust ─────────────────────────────────────────────────────
const TRUST = [
  {
    icon: IconShieldLock, title: 'Без биометрии',
    text: 'Люди различаются по внешнему виду, а не по лицу. Никаких биометрических персональных данных — и никаких требований 152-ФЗ к ним.',
  },
  {
    icon: IconServer2, title: 'Данные в контуре РФ',
    text: 'Видео и события хранятся на наших серверах в России. Для закрытых объектов — установка полностью внутри вашей сети.',
  },
  {
    icon: IconListDetails, title: 'Полная прозрачность',
    text: 'Каждое действие в системе фиксируется в журнале аудита: кто смотрел, что менял и когда.',
  },
]

function Trust(): React.JSX.Element {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
      <div className="grid gap-4 lg:grid-cols-3">
        {TRUST.map((t, i) => (
          <Reveal key={t.title} delay={i * 120}>
            <div className="h-full rounded-xl border border-border/70 bg-card/40 p-6">
              <t.icon className="mb-3 h-6 w-6 text-brand" stroke={1.6} />
              <h3 className="font-display text-base font-semibold">{t.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

// ── CTA / form ────────────────────────────────────────────────
function Demo(): React.JSX.Element {
  return (
    <section id="demo" className="relative scroll-mt-16 overflow-hidden border-t border-border/50">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-brand/10 blur-[140px]" />
      <div className="relative mx-auto max-w-3xl px-4 py-20 sm:py-28">
        <Reveal>
          <h2 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Посмотрите систему <span className="text-brand">на живой точке</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Оставьте контакт — покажем работающую платформу, ответим на вопросы
            и посчитаем стоимость под ваши камеры. Подключение без замены оборудования.
          </p>
        </Reveal>
        <Reveal delay={150} className="mt-10">
          <DemoForm />
        </Reveal>
      </div>
    </section>
  )
}

function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-border/50">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/30">
            <IconShieldCheck className="h-3.5 w-3.5" stroke={1.9} />
          </span>
          <span className="font-display font-semibold tracking-tight text-foreground">
            BZK-VIZI<span className="text-brand">AI</span>
          </span>
          <span className="ml-2">© {new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-5">
          <span>Видеоаналитика · без биометрии · данные в РФ</span>
          <Link href="/login" className="text-foreground transition-colors hover:text-brand">
            Вход для клиентов
          </Link>
        </div>
      </div>
    </footer>
  )
}

export function Landing(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />
      <Features />
      <HowItWorks />
      <Analytics />
      <Audiences />
      <Trust />
      <Demo />
      <Footer />
    </div>
  )
}
