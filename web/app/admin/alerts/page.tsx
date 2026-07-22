'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconBell, IconTrash, IconBrandTelegram, IconSend, IconWebhook, IconMoon } from '@tabler/icons-react'
import { EventType } from '@shared/events.schema'
import {
  getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, testAlertRule, errorMessage,
  type AlertRule, type AlertRuleInput,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { eventTypeLabels, severityLabels } from '@/lib/labels'

// entries/exits are statistics — they never alert (were the main flood source)
const NON_ALERTABLE = new Set(['zone_entry', 'zone_exit'])
const EVENT_TYPES = EventType.options.filter((t) => !NON_ALERTABLE.has(t))
const SEVERITIES = ['info', 'warn', 'critical'] as const
const eventTypeLabel = (t: string): string =>
  eventTypeLabels[t as keyof typeof eventTypeLabels] ?? t

function tgChatId(channels: Record<string, unknown>[]): string {
  const tg = channels.find((c) => (c as { type?: unknown }).type === 'telegram')
  const id = tg ? (tg as { chat_id?: unknown }).chat_id : undefined
  return id !== undefined && id !== null ? String(id) : ''
}
function webhookUrl(channels: Record<string, unknown>[]): string {
  const wh = channels.find((c) => (c as { type?: unknown }).type === 'webhook')
  const url = wh ? (wh as { url?: unknown }).url : undefined
  return typeof url === 'string' ? url : ''
}
function buildChannels(chatId: string, webhook: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  if (chatId.trim()) out.push({ type: 'telegram', chat_id: chatId.trim() })
  if (webhook.trim()) out.push({ type: 'webhook', url: webhook.trim() })
  return out
}
function strField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key]
  return typeof v === 'string' ? v : ''
}

interface RuleFormState {
  eventType: string
  chatId: string
  webhook: string
  cooldown: string
  minSeverity: string
  quietFrom: string
  quietTo: string
  enabled: boolean
}

function ruleToForm(rule: AlertRule): RuleFormState {
  return {
    eventType: rule.eventType,
    chatId: tgChatId(rule.channels),
    webhook: webhookUrl(rule.channels),
    cooldown: String(rule.cooldownSeconds),
    minSeverity: strField(rule.conditions, 'min_severity') || 'info',
    quietFrom: strField(rule.schedule, 'quiet_from'),
    quietTo: strField(rule.schedule, 'quiet_to'),
    enabled: rule.enabled,
  }
}

function formToInput(f: RuleFormState): AlertRuleInput {
  const schedule: Record<string, unknown> = {}
  if (f.quietFrom && f.quietTo) {
    schedule.quiet_from = f.quietFrom
    schedule.quiet_to = f.quietTo
  }
  return {
    event_type: f.eventType,
    channels: buildChannels(f.chatId, f.webhook),
    cooldown_seconds: Number(f.cooldown) || 60,
    enabled: f.enabled,
    conditions: f.minSeverity !== 'info' ? { min_severity: f.minSeverity } : {},
    schedule,
  }
}

function RuleForm({ form, setForm }: {
  form: RuleFormState
  setForm: React.Dispatch<React.SetStateAction<RuleFormState>>
}): React.JSX.Element {
  const set = (patch: Partial<RuleFormState>): void => setForm((f) => ({ ...f, ...patch }))
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label>Тип события</Label>
        <Select value={form.eventType} onValueChange={(v) => set({ eventType: v })}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{eventTypeLabels[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Мин. важность</Label>
        <Select value={form.minSeverity} onValueChange={(v) => set({ minSeverity: v })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{severityLabels[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>ID чата Telegram</Label>
        <Input value={form.chatId} onChange={(e) => set({ chatId: e.target.value })}
          className="w-44" placeholder="напр. -1001234567890" />
      </div>
      <div className="space-y-1">
        <Label>Webhook URL</Label>
        <Input value={form.webhook} onChange={(e) => set({ webhook: e.target.value })}
          className="w-56" placeholder="https:// (необязательно)" />
      </div>
      <div className="space-y-1">
        <Label>Пауза, сек</Label>
        <Input type="number" value={form.cooldown} onChange={(e) => set({ cooldown: e.target.value })}
          className="w-24" />
      </div>
      <div className="space-y-1">
        <Label>Тихие часы: с</Label>
        <Input type="time" value={form.quietFrom} onChange={(e) => set({ quietFrom: e.target.value })}
          className="w-28" />
      </div>
      <div className="space-y-1">
        <Label>по</Label>
        <Input type="time" value={form.quietTo} onChange={(e) => set({ quietTo: e.target.value })}
          className="w-28" />
      </div>
      <Button size="sm" variant={form.enabled ? 'default' : 'outline'}
        onClick={() => set({ enabled: !form.enabled })}>
        {form.enabled ? 'Включено' : 'Выключено'}
      </Button>
    </div>
  )
}

function RuleRow(
  { rule, onChanged }: { rule: AlertRule; onChanged: () => void },
): React.JSX.Element {
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState<RuleFormState>(() => ruleToForm(rule))
  const [testMsg, setTestMsg] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => updateAlertRule(rule.id, formToInput(form)),
    onSuccess: () => { setEdit(false); onChanged() },
  })
  const rm = useMutation({ mutationFn: () => deleteAlertRule(rule.id), onSuccess: onChanged })
  const test = useMutation({
    mutationFn: () => testAlertRule(rule.id),
    onSuccess: () => setTestMsg('Тест отправлен — проверь Telegram/webhook'),
    onError: (err) => setTestMsg(errorMessage(err, 'Не удалось отправить тест')),
  })

  const quietFrom = strField(rule.schedule, 'quiet_from')
  const quietTo = strField(rule.schedule, 'quiet_to')
  const minSev = strField(rule.conditions, 'min_severity')

  return (
    <div className="border-b border-border/60 p-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{eventTypeLabel(rule.eventType)}</span>
        {tgChatId(rule.channels) && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <IconBrandTelegram className="h-3.5 w-3.5" stroke={1.75} />
            {tgChatId(rule.channels)}
          </span>
        )}
        {webhookUrl(rule.channels) && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" title={webhookUrl(rule.channels)}>
            <IconWebhook className="h-3.5 w-3.5" stroke={1.75} /> webhook
          </span>
        )}
        {minSev && minSev !== 'info' && (
          <span className="text-xs text-muted-foreground">
            от «{severityLabels[minSev as keyof typeof severityLabels] ?? minSev}»
          </span>
        )}
        {quietFrom && quietTo && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <IconMoon className="h-3.5 w-3.5" stroke={1.75} /> {quietFrom}–{quietTo}
          </span>
        )}
        <span className="text-xs text-muted-foreground">пауза {rule.cooldownSeconds}с</span>
        <span className={
          rule.enabled
            ? 'rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] text-brand'
            : 'rounded-full border border-zinc-500/30 bg-zinc-500/15 px-2 py-0.5 text-[11px] text-zinc-300'
        }>
          {rule.enabled ? 'вкл' : 'выкл'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={test.isPending}
            onClick={() => test.mutate()} title="Отправить тестовое уведомление">
            <IconSend className="h-4 w-4" stroke={1.75} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEdit((v) => !v)}>
            {edit ? 'Отмена' : 'Изменить'}
          </Button>
          <Button
            size="sm" variant="ghost" className="text-muted-foreground hover:text-red-300"
            disabled={rm.isPending}
            onClick={() => {
              if (confirm('Удалить правило оповещения? Уведомления по нему перестанут приходить.')) rm.mutate()
            }}
          >
            <IconTrash className="h-4 w-4" stroke={1.75} />
          </Button>
        </div>
      </div>
      {testMsg && <p className="mt-1 text-xs text-muted-foreground">{testMsg}</p>}
      {edit && (
        <div className="mt-3 space-y-2">
          <RuleForm form={form} setForm={setForm} />
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>
        </div>
      )}
    </div>
  )
}

const EMPTY_FORM: RuleFormState = {
  eventType: EVENT_TYPES[0] ?? 'crowd', chatId: '', webhook: '',
  cooldown: '60', minSeverity: 'info', quietFrom: '', quietTo: '', enabled: true,
}

export default function AdminAlertsPage(): React.JSX.Element {
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['admin', 'alert-rules'], queryFn: getAlertRules })
  const invalidate = (): void => void qc.invalidateQueries({ queryKey: ['admin', 'alert-rules'] })

  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM)
  const add = useMutation({
    mutationFn: () => createAlertRule(formToInput(form)),
    onSuccess: () => { setForm(EMPTY_FORM); invalidate() },
  })

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconBell className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Правила уведомлений</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Событие выбранного типа рассылается в Telegram и/или на webhook. Дубликаты гасятся паузой
        на пару (правило, человек) — один и тот же посетитель на всех камерах считается одним.
        Критичные события уходят сразу; остальные копятся и приходят одной сводкой
        (интервал — в «Настройках»). Входы/выходы из зон в уведомления не попадают —
        они видны в ленте событий и статистике. «Тихие часы» (в часовом поясе точки)
        откладывают уведомления на ночь. Кнопка со стрелкой — тестовая отправка.
      </p>

      <div className="overflow-hidden rounded-lg border border-border/70">
        {rules.data?.map((r) => <RuleRow key={r.id} rule={r} onChanged={invalidate} />)}
        {rules.data?.length === 0 && <div className="p-3 text-sm text-muted-foreground">Правил нет.</div>}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Добавить правило</h2>
        <div className="space-y-2">
          <RuleForm form={form} setForm={setForm} />
          <Button disabled={add.isPending} onClick={() => add.mutate()}>Добавить</Button>
        </div>
        {add.isError && <p className="text-sm text-red-400">{errorMessage(add.error)}</p>}
      </section>
    </main>
  )
}
