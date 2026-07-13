import type { Metadata } from 'next'
import { Landing } from '@/components/landing/landing'

export const metadata: Metadata = {
  title: 'BZK-VIZIAI — видеоаналитика для ПВЗ и бизнеса',
  description:
    'Подключаем обычные камеры точки к ИИ: подсчёт посетителей, контроль очередей, '
    + 'зоны, видеоархив и алерты в Telegram. Без биометрии, данные в РФ.',
}

export default function Home(): React.JSX.Element {
  return <Landing />
}
