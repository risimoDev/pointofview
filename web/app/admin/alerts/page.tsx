'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconBell, IconTrash, IconBrandTelegram } from '@tabler/icons-react'
import { EventType } from '@shared/events.schema'
import {
  getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, type AlertRule,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { eventTypeLabels } from '@/lib/labels'

const EVENT_TYPES = EventType.options
const eventTypeLabel = (t: string): string =>
  eventTypeLabels[t as keyof typeof eventTypeLabels] ?? t

function tgChatId(channels: Record<string, unknown>[]): string {
  const tg = channels.find((c) => (c as { type?: unknown }).type === 'telegram')
  const id = tg ? (tg as { chat_id?: unknown }).chat_id : undefined
  return id !== undefined && id !== null ? String(id) : ''
}
function buildChannels(chatId: string): Record<string, unknown>[] {
  return chatId.trim() ? [{ type: 'telegram', chat_id: chatId.trim() }] : []
}

function RuleRow(
  { rule, onChanged }: { rule: AlertRule; onChanged: () => void },
): React.JSX.Element {
  const [edit, setEdit] = useState(false)
  const [eventType, setEventType] = useState(rule.eventType)
  const [chatId, setChatId] = useState(tgChatId(rule.channels))
  const [cooldown, setCooldown] = useState(String(rule.cooldownSeconds))
  const [enabled, setEnabled] = useState(rule.enabled)

  const save = useMutation({
    mutationFn: () => updateAlertRule(rule.id, {
      event_type: eventType, channels: buildChannels(chatId),
      cooldown_seconds: Number(cooldown) || 60, enabled,
    }),
    onSuccess: () => { setEdit(false); onChanged() },
  })
  const rm = useMutation({ mutationFn: () => deleteAlertRule(rule.id), onSuccess: onChanged })

  return (
    <div className="border-b border-border/60 p-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{eventTypeLabel(rule.eventType)}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <IconBrandTelegram className="h-3.5 w-3.5" stroke={1.75} />
          {tgChatId(rule.channels) || '—'}
        </span>
        <span className="text-xs text-muted-foreground">пауза {rule.cooldownSeconds}с</span>
        <span className={
          rule.enabled
            ? 'rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] text-brand'
            : 'rounded-full border border-zinc-500/30 bg-zinc-500/15 px-2 py-0.5 text-[11px] text-zinc-300'
        }>
          {rule.enabled ? 'вкл' : 'выкл'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEdit((v) => !v)}>
            {edit ? 'Отмена' : 'Изменить'}
          </Button>
          <Button
            size="sm" variant="ghost" className="text-muted-foreground hover:text-red-300"
            disabled={rm.isPending} onClick={() => rm.mutate()}
          >
            <IconTrash className="h-4 w-4" stroke={1.75} />
          </Button>
        </div>
      </div>
      {edit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Тип события</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{eventTypeLabels[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>ID чата Telegram</Label>
            <Input value={chatId} onChange={(e) => setChatId(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label>Пауза, сек</Label>
            <Input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} className="w-28" />
          </div>
          <Button size="sm" variant={enabled ? 'default' : 'outline'} onClick={() => setEnabled((v) => !v)}>
            {enabled ? 'Включено' : 'Выключено'}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
        </div>
      )}
    </div>
  )
}

export default function AdminAlertsPage(): React.JSX.Element {
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['admin', 'alert-rules'], queryFn: getAlertRules })
  const invalidate = (): void => void qc.invalidateQueries({ queryKey: ['admin', 'alert-rules'] })

  const [eventType, setEventType] = useState<string>(EVENT_TYPES[0] ?? 'crowd')
  const [chatId, setChatId] = useState('')
  const [cooldown, setCooldown] = useState('60')
  const add = useMutation({
    mutationFn: () => createAlertRule({
      event_type: eventType, channels: buildChannels(chatId),
      cooldown_seconds: Number(cooldown) || 60, enabled: true,
    }),
    onSuccess: () => { setChatId(''); invalidate() },
  })

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconBell className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Правила алертов</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Событие выбранного типа рассылается в Telegram-чат. Дубликаты гасятся паузой
        на пару (правило, камера). Отправку выполняет воркер алертов (нужен запущенный воркер и TELEGRAM_BOT_TOKEN).
      </p>

      <div className="overflow-hidden rounded-lg border border-border/70">
        {rules.data?.map((r) => <RuleRow key={r.id} rule={r} onChanged={invalidate} />)}
        {rules.data?.length === 0 && <div className="p-3 text-sm text-muted-foreground">Правил нет.</div>}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Добавить правило</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); add.mutate() }}
        >
          <div className="space-y-1">
            <Label>Тип события</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{eventTypeLabels[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>ID чата Telegram</Label>
            <Input value={chatId} onChange={(e) => setChatId(e.target.value)} className="w-44" placeholder="напр. -1001234567890" />
          </div>
          <div className="space-y-1">
            <Label>Пауза, сек</Label>
            <Input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} className="w-28" />
          </div>
          <Button type="submit" disabled={add.isPending}>Добавить</Button>
        </form>
        {add.isError && <p className="text-sm text-red-400">Не удалось создать правило</p>}
      </section>
    </main>
  )
}
