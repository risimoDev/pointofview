'use client'

import type * as React from 'react'
import { useState } from 'react'
import { IconSend, IconCircleCheck } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const OBJECT_TYPES = [
  { value: 'pvz', label: 'ПВЗ' },
  { value: 'production', label: 'Производство' },
  { value: 'retail', label: 'Ритейл' },
  { value: 'office', label: 'Офис' },
  { value: 'other', label: 'Другое' },
]

export function DemoForm(): React.JSX.Element {
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [objectType, setObjectType] = useState('pvz')
  const [cameras, setCameras] = useState('')
  const [comment, setComment] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setState('sending')
    setError(null)
    try {
      const res = await fetch('/api/v1/public/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, contact, object_type: objectType,
          ...(cameras.trim() ? { cameras: cameras.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(body?.message ?? 'Не удалось отправить заявку')
      }
      setState('done')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Не удалось отправить заявку')
    }
  }

  if (state === 'done') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-brand/30 bg-card/60 px-8 py-12 text-center">
        <IconCircleCheck className="h-12 w-12 text-brand" stroke={1.5} />
        <p className="font-display text-lg font-semibold">Заявка отправлена</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Свяжемся с вами в ближайшее время, покажем систему на живой точке
          и посчитаем стоимость под ваши камеры.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="lead-name">Как вас зовут</Label>
          <Input
            id="lead-name" value={name} required maxLength={120}
            onChange={(e) => setName(e.target.value)} placeholder="Имя"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-contact">Телефон или Telegram</Label>
          <Input
            id="lead-contact" value={contact} required maxLength={200}
            onChange={(e) => setContact(e.target.value)} placeholder="+7… или @ник"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Тип объекта</Label>
          <Select value={objectType} onValueChange={setObjectType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {OBJECT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-cameras">Сколько камер (примерно)</Label>
          <Input
            id="lead-cameras" value={cameras} maxLength={40}
            onChange={(e) => setCameras(e.target.value)} placeholder="например, 4"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lead-comment">Комментарий (необязательно)</Label>
        <Input
          id="lead-comment" value={comment} maxLength={1000}
          onChange={(e) => setComment(e.target.value)} placeholder="Что хотите контролировать?"
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" size="lg" disabled={state === 'sending'}>
          <IconSend className="mr-2 h-4 w-4" stroke={1.75} />
          {state === 'sending' ? 'Отправляем…' : 'Запросить демо'}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Никакого спама: свяжемся один раз, чтобы договориться о показе.
      </p>
    </form>
  )
}
