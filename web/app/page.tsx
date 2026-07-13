import type { Metadata } from 'next'
import { Landing } from '@/components/landing/landing'

export const metadata: Metadata = {
  title: 'BZK-VIZIAI · видеоаналитика для ПВЗ и бизнеса',
  description:
    'Подключаем обычные камеры пункта выдачи к видеоаналитике. Подсчёт посетителей, '
    + 'очереди, архив и уведомления в Telegram. Без биометрии, данные в России.',
}

export default function Home(): React.JSX.Element {
  return <Landing />
}
