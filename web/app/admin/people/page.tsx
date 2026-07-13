'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconUserCheck, IconUserMinus, IconUsers, IconTrash } from '@tabler/icons-react'
import { deletePerson, getPeople, setPersonStaff, type Person } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function fmtSeen(ts: number | null): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function PersonCard({ person, onChanged }: {
  person: Person; onChanged: () => void
}): React.JSX.Element {
  const [name, setName] = useState(person.name ?? '')
  const [imgOk, setImgOk] = useState(true)

  const mark = useMutation({
    mutationFn: (staff: boolean) => setPersonStaff(person.gid, staff, name.trim() || undefined),
    onSuccess: onChanged,
  })
  const remove = useMutation({
    mutationFn: () => deletePerson(person.gid),
    onSuccess: onChanged,
  })

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card/40">
      <div className="relative aspect-[3/4] bg-black/40">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={person.snapshotUrl}
            alt="Кадр человека"
            className="h-full w-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            нет кадра
          </div>
        )}
        {person.staff && (
          <span className="absolute left-2 top-2 rounded-full bg-brand/90 px-2 py-0.5 text-[10px] font-medium text-white">
            Сотрудник
          </span>
        )}
      </div>
      <div className="space-y-2 p-2.5">
        {person.staff ? (
          <>
            <div className="truncate text-sm font-medium">{person.name || 'Без имени'}</div>
            <Button
              size="sm" variant="outline" className="w-full"
              disabled={mark.isPending}
              onClick={() => mark.mutate(false)}
            >
              <IconUserMinus className="mr-1 h-4 w-4" stroke={1.75} /> Убрать из сотрудников
            </Button>
          </>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              {person.siteName ?? ''}{person.lastSeen ? ` · ${fmtSeen(person.lastSeen)}` : ''}
            </div>
            <Input
              placeholder="Имя (необязательно)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
            />
            <Button
              size="sm" className="w-full"
              disabled={mark.isPending}
              onClick={() => mark.mutate(true)}
            >
              <IconUserCheck className="mr-1 h-4 w-4" stroke={1.75} /> Это сотрудник
            </Button>
            <Button
              size="sm" variant="outline" className="w-full"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <IconTrash className="mr-1 h-4 w-4" stroke={1.75} /> Удалить
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default function PeoplePage(): React.JSX.Element {
  const qc = useQueryClient()
  const people = useQuery({ queryKey: ['admin', 'people'], queryFn: getPeople, refetchInterval: 30_000 })
  const onChanged = (): void => void qc.invalidateQueries({ queryKey: ['admin', 'people'] })

  const staff = (people.data ?? []).filter((p) => p.staff)
  const visitors = (people.data ?? []).filter((p) => !p.staff)

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconUsers className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Люди</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Система запоминает внешний вид людей на камерах точки (функция «Сквозная
        идентификация»). Отметь сотрудников — они перестанут учитываться как посетители
        и не будут вызывать оповещения об очередях, скоплениях и запретных зонах.
        Список посетителей очищается автоматически (по умолчанию через 12 часов).
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Сотрудники ({staff.length})</h2>
        {staff.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Пока никого. Найди сотрудника в списке ниже и нажми «Это сотрудник».
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {staff.map((p) => <PersonCard key={p.gid} person={p} onChanged={onChanged} />)}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Замеченные люди ({visitors.length})
        </h2>
        {visitors.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Список пуст. Он наполняется, когда включена функция «Сквозная идентификация»
            и анализатор видит людей на камерах.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {visitors.map((p) => <PersonCard key={p.gid} person={p} onChanged={onChanged} />)}
        </div>
      </section>
    </main>
  )
}
