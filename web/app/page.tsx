import type { Metadata } from 'next'
import { Landing } from '@/components/landing/landing'

export const metadata: Metadata = {
  title: 'BZK-VIZIAI · видеоаналитика охраны труда для производства',
  description:
    'Подключаем камеры цеха или строительной площадки к видеоаналитике. Контроль '
    + 'касок и жилетов, опасные зоны, падение человека, работа в одиночку. '
    + 'Оповещения в Telegram и отчёты для проверок. Без биометрии, работает офлайн.',
}

export default function Home(): React.JSX.Element {
  return <Landing />
}
