import type { Camera, UiEvent, Zone } from '@shared/events.schema'

// Единая точка перевода значений-энумов, приходящих с бэкенда, на русский.
// UI нигде не должен показывать сырые английские коды — только эти подписи.

export const eventTypeLabels: Record<UiEvent['type'], string> = {
  zone_entry: 'Вход в зону',
  zone_exit: 'Выход из зоны',
  zone_violation: 'Нарушение зоны',
  queue_alert: 'Очередь',
  ppe_violation: 'Нарушение СИЗ',
  repack_event: 'Перекладка',
  shelf_violation: 'Нарушение выкладки',
  crowd: 'Скопление людей',
  unknown_person: 'Неизвестный человек',
}

export const severityLabels: Record<UiEvent['severity'], string> = {
  info: 'Инфо',
  warn: 'Предупреждение',
  critical: 'Критично',
}

export const cameraStatusLabels: Record<Camera['status'], string> = {
  online: 'В сети',
  offline: 'Не в сети',
  error: 'Ошибка',
}

export const sourceTypeLabels: Record<Camera['sourceType'], string> = {
  rtsp_pull: 'RTSP (pull)',
  srt_push: 'SRT (push)',
  file: 'Видеофайл',
}

export const zoneKindLabels: Record<Zone['kind'], string> = {
  counter: 'Счётчик',
  desk: 'Стол выдачи',
  shelf: 'Полка',
  queue: 'Очередь',
  forbidden: 'Запретная зона',
  required_ppe: 'Зона СИЗ',
}

export type UserRole = 'super' | 'admin' | 'manager' | 'operator'
export const roleLabels: Record<UserRole, string> = {
  super: 'Суперадмин',
  admin: 'Администратор',
  manager: 'Менеджер',
  operator: 'Оператор',
}

/** Safe lookup: fall back to the raw code if an unknown value slips through. */
export function labelOf<K extends string>(map: Record<K, string>, key: K): string {
  return map[key] ?? key
}
