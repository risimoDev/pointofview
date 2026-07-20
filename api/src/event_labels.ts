// RU labels for event enums used in OUTGOING artifacts (Telegram alerts, PDF/
// Excel reports). The web UI has its own copy in web/lib/labels.ts — keep both
// in sync when adding an event type.

export const TYPE_LABELS: Record<string, string> = {
  zone_entry: 'Вход в зону', zone_exit: 'Выход из зоны',
  zone_violation: 'Нарушение зоны', queue_alert: 'Очередь',
  ppe_violation: 'Нарушение СИЗ', repack_event: 'Перепаковка',
  shelf_violation: 'Нарушение выкладки', crowd: 'Скопление людей',
  unknown_person: 'Неизвестный человек',
  camera_offline: 'Камера не в сети', camera_online: 'Камера снова в сети',
  fall_detected: 'Падение человека',
  lone_worker: 'Работа в одиночку',
  camera_tampered: 'Камера перекрыта или сдвинута',
}

export const SEVERITY_LABELS: Record<string, string> = {
  info: 'Инфо', warn: 'Предупреждение', critical: 'Критично',
}

export function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t
}
