'use client'

import type * as React from 'react'
import { useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  IconUserCheck, IconUserMinus, IconUsers, IconTrash, IconCamera, IconUserPlus,
} from '@tabler/icons-react'
import {
  createStaff, deletePerson, getPeople, mergeStaff, resetPeople, setPersonStaff,
  uploadFacePhoto, errorMessage,
  type Person,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

function fmtSeen(ts: number | null): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function PersonCard({ person, staffList, selected, onSelect, onChanged }: {
  person: Person; staffList: Person[]; onChanged: () => void
  selected?: boolean; onSelect?: ((gid: string, on: boolean) => void) | undefined
}): React.JSX.Element {
  const [name, setName] = useState(person.name ?? '')
  const [mergeInto, setMergeInto] = useState('')
  const [imgOk, setImgOk] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const mark = useMutation({
    mutationFn: (args: { staff: boolean; mergeInto?: string }) =>
      setPersonStaff(person.gid, args.staff, name.trim() || undefined, args.mergeInto),
    onSuccess: onChanged,
  })
  const remove = useMutation({
    mutationFn: () => deletePerson(person.gid),
    onSuccess: onChanged,
  })
  const face = useMutation({
    mutationFn: (file: File) => uploadFacePhoto(person.gid, file),
    onSuccess: () => {
      setMsg('Фото в обработке (≈10 с)')
      setTimeout(onChanged, 12_000)
    },
    onError: (err) => setMsg(errorMessage(err, 'Не удалось загрузить фото')),
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
        {onSelect && (
          <label className="absolute right-2 top-2 flex cursor-pointer items-center gap-1 rounded-md bg-black/60 px-1.5 py-1">
            <input
              type="checkbox"
              checked={Boolean(selected)}
              onChange={(e) => onSelect(person.gid, e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--brand,#14b8a6)]"
            />
            <span className="text-[10px] text-white">выбрать</span>
          </label>
        )}
      </div>
      <div className="space-y-2 p-2.5">
        {person.staff ? (
          <>
            <div className="truncate text-sm font-medium">{person.name || 'Без имени'}</div>
            <div className="text-[11px] text-muted-foreground">
              Образцы: одежда {person.clothingSamples} · лицо {person.faceSamples}
            </div>
            {person.faceSamples === 0 && (
              <p className="text-[11px] text-amber-400">
                Лицо не обучено — добавьте 1–3 чётких фото анфас, иначе после
                переодевания сотрудник не распознается.
              </p>
            )}
            {person.faceFailed > 0 && (
              <p className="text-[11px] text-amber-400">
                {person.faceFailed} фото не распозналось — переснимите анфас при
                хорошем освещении.
              </p>
            )}
            <input
              ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) face.mutate(f)
                e.target.value = ''
              }}
            />
            <Button
              size="sm" variant="outline" className="w-full"
              disabled={face.isPending}
              onClick={() => fileRef.current?.click()}
              title="Чёткое фото лица (анфас) — сотрудник будет узнаваться даже в новой одежде"
            >
              <IconCamera className="mr-1 h-4 w-4" stroke={1.75} /> Добавить фото лица
            </Button>
            <Button
              size="sm" variant="outline" className="w-full"
              disabled={mark.isPending}
              onClick={() => mark.mutate({ staff: false })}
            >
              <IconUserMinus className="mr-1 h-4 w-4" stroke={1.75} /> Убрать из сотрудников
            </Button>
            {msg && <p className="text-[11px] text-brand">{msg}</p>}
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
              onClick={() => mark.mutate({ staff: true })}
            >
              <IconUserCheck className="mr-1 h-4 w-4" stroke={1.75} /> Это сотрудник
            </Button>
            {staffList.length > 0 && (
              <div className="flex gap-1.5">
                <Select value={mergeInto} onValueChange={setMergeInto}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue placeholder="…или добавить к…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((s) => (
                      <SelectItem key={s.gid} value={s.gid}>
                        {s.name || s.gid.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm" variant="outline" className="h-8 shrink-0 px-2"
                  disabled={!mergeInto || mark.isPending}
                  onClick={() => mark.mutate({ staff: true, mergeInto })}
                  title="Добавить этот образ как ещё один образец выбранного сотрудника"
                >
                  <IconUserPlus className="h-4 w-4" stroke={1.75} />
                </Button>
              </div>
            )}
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

function AddStaffForm({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: () => createStaff(name.trim()),
    onSuccess: () => {
      setName('')
      setHint('Сотрудник создан — добавьте 1–3 фото лица на его карточке ниже.')
      onChanged()
    },
    onError: (err) => setHint(errorMessage(err, 'Не удалось создать сотрудника')),
  })
  return (
    <div className="space-y-1.5">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate() }}
      >
        <Input
          placeholder="Имя сотрудника"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-56"
        />
        <Button type="submit" size="sm" disabled={!name.trim() || add.isPending}>
          <IconUserPlus className="mr-1 h-4 w-4" stroke={1.75} /> Добавить сотрудника
        </Button>
        <span className="text-xs text-muted-foreground">
          — заранее, по фото с телефона; ждать появления на камерах не нужно.
        </span>
      </form>
      {hint && <p className="text-xs text-brand">{hint}</p>}
    </div>
  )
}

export default function PeoplePage(): React.JSX.Element {
  const qc = useQueryClient()
  const people = useQuery({ queryKey: ['admin', 'people'], queryFn: getPeople, refetchInterval: 30_000 })
  const onChanged = (): void => void qc.invalidateQueries({ queryKey: ['admin', 'people'] })

  const staff = (people.data ?? []).filter((p) => p.staff)
  const visitors = (people.data ?? []).filter((p) => !p.staff)

  // duplicate cleanup: pick the duplicates, pick the card to keep, merge
  const [picked, setPicked] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const togglePick = (gid: string, on: boolean): void =>
    setPicked((s) => (on ? [...s, gid] : s.filter((g) => g !== gid)))
  const merge = useMutation({
    mutationFn: () => mergeStaff(target, picked),
    onSuccess: (merged) => {
      setNote(`Объединено карточек: ${merged}`)
      setPicked([]); setTarget('')
      onChanged()
    },
    onError: (err) => setNote(errorMessage(err, 'Не удалось объединить')),
  })
  const reset = useMutation({
    mutationFn: (scope: 'visitors' | 'all') => resetPeople(scope),
    onSuccess: () => { setNote('Обучение сброшено'); setPicked([]); onChanged() },
    onError: (err) => setNote(errorMessage(err, 'Не удалось сбросить')),
  })
  const mergeSources = picked.filter((g) => g !== target)

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconUsers className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Люди</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Посетители различаются по внешнему виду (одежда, силуэт) — без биометрии.
        Сотрудники — по нескольким образцам одежды и, если загрузить фото, по лицу:
        так система узнаёт сотрудника даже после переодевания и не путает его с посетителем.
        Увидел сотрудника в списке «замеченных» — добавь его образ к существующей карточке
        (кнопка со значком +), а не создавай нового.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Сотрудники ({staff.length})</h2>
        <AddStaffForm onChanged={onChanged} />
        {staff.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Пока никого. Добавь сотрудника по имени выше — или найди его в списке
            «замеченных» ниже и нажми «Это сотрудник».
          </p>
        )}
        {staff.length > 1 && (
          <div className="space-y-2 rounded-lg border border-border/70 bg-card/40 p-3">
            <p className="text-xs text-muted-foreground">
              Один человек попал в список несколько раз? Отметьте галочками все его
              карточки, выберите ту, которую оставить (с именем), и объедините —
              образцы одежды и лица сложатся в одну карточку, лишние исчезнут.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Выбрано: {picked.length}
              </span>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue placeholder="Оставить карточку…" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.gid} value={s.gid}>
                      {s.name || `Без имени ${s.gid.slice(0, 6)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!target || mergeSources.length === 0 || merge.isPending}
                onClick={() => merge.mutate()}
              >
                <IconUsers className="mr-1 h-4 w-4" stroke={1.75} />
                Объединить ({mergeSources.length})
              </Button>
              {picked.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setPicked([])}>
                  Снять выбор
                </Button>
              )}
              <Button
                size="sm" variant="outline"
                onClick={() => setPicked(staff.filter((s) => !s.name).map((s) => s.gid))}
                title="Отметить все карточки без имени — обычно это и есть дубли"
              >
                Отметить безымянные
              </Button>
            </div>
            {note && <p className="text-xs text-brand">{note}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {staff.map((p) => (
            <PersonCard
              key={p.gid} person={p} staffList={staff} onChanged={onChanged}
              selected={picked.includes(p.gid)}
              onSelect={staff.length > 1 ? togglePick : undefined}
            />
          ))}
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
          {visitors.map((p) => (
            <PersonCard key={p.gid} person={p} staffList={staff} onChanged={onChanged} />
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-red-500/25 bg-red-500/[0.04] p-3">
        <h2 className="text-sm font-medium text-muted-foreground">Сброс обучения</h2>
        <p className="text-xs text-muted-foreground">
          Нужен, когда накопился мусор или сменился способ сравнения людей
          (переход на модель OSNet — старые образцы с ней несовместимы).
          «Замеченных» система наберёт заново за несколько часов, сотрудников
          придётся отметить повторно.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm" variant="outline" disabled={reset.isPending}
            onClick={() => {
              if (confirm('Удалить всех «замеченных»? Сотрудники останутся.')) {
                reset.mutate('visitors')
              }
            }}
          >
            <IconTrash className="mr-1 h-4 w-4" stroke={1.75} /> Очистить замеченных
          </Button>
          <Button
            size="sm" variant="outline" disabled={reset.isPending}
            onClick={() => {
              if (confirm('Удалить ВСЁ, включая сотрудников и их фото лиц? Отменить нельзя.')) {
                reset.mutate('all')
              }
            }}
          >
            <IconTrash className="mr-1 h-4 w-4" stroke={1.75} /> Сбросить всё, включая сотрудников
          </Button>
        </div>
      </section>
    </main>
  )
}
