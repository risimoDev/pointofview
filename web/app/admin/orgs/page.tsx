'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconBuildingSkyscraper, IconCopy, IconLogin2 } from '@tabler/icons-react'
import { getOrgs, createOrg, enterOrg } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const MODE_LABELS: Record<string, string> = { cloud: 'Облако', onpremise: 'Локально' }

export default function OrgsPage(): React.JSX.Element {
  const qc = useQueryClient()
  const orgs = useQuery({ queryKey: ['platform', 'orgs'], queryFn: getOrgs })

  const [name, setName] = useState('')
  const [siteName, setSiteName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [mode, setMode] = useState('cloud')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: () => createOrg({
      name, mode,
      ...(siteName ? { site_name: siteName } : {}),
      ...(ownerName ? { owner_name: ownerName } : {}),
    }),
    onSuccess: (r) => {
      setInviteUrl(`${window.location.origin}/invite/${r.owner_invite_token}`)
      setName(''); setSiteName(''); setOwnerName('')
      void qc.invalidateQueries({ queryKey: ['platform', 'orgs'] })
    },
  })
  const enter = useMutation({
    mutationFn: enterOrg,
    onSuccess: () => { window.location.href = '/dashboard' },
  })

  return (
    <main className="space-y-6">
      <div className="flex items-center gap-2">
        <IconBuildingSkyscraper className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Организации</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Все предприятия на платформе. «Войти» открывает организацию с правами
        владельца — для настройки и помощи (действие пишется в журнал).
      </p>

      <div className="overflow-hidden rounded-lg border border-border/70">
        {orgs.data?.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 border-b border-border/60 p-3 last:border-0">
            <span className="text-sm font-medium">{o.name}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {MODE_LABELS[o.mode] ?? o.mode}
            </span>
            <span className="text-xs text-muted-foreground">
              площадок {o.sites} · камер {o.cameras} · пользователей {o.users}
            </span>
            <Button
              size="sm" variant="outline" className="ml-auto"
              disabled={enter.isPending}
              onClick={() => enter.mutate(o.id)}
            >
              <IconLogin2 className="mr-1 h-4 w-4" stroke={1.75} /> Войти
            </Button>
          </div>
        ))}
        {orgs.data?.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">Организаций нет.</div>
        )}
      </div>

      <form
        className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4"
        onSubmit={(e) => { e.preventDefault(); if (name) add.mutate() }}
      >
        <span className="text-sm font-medium">Новая организация</span>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
          </div>
          <div className="space-y-1">
            <Label>Первая площадка</Label>
            <Input
              value={siteName} onChange={(e) => setSiteName(e.target.value)}
              placeholder="Основная площадка" className="w-48"
            />
          </div>
          <div className="space-y-1">
            <Label>Имя владельца</Label>
            <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label>Режим</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cloud">Облако</SelectItem>
                <SelectItem value="onpremise">Локально</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={!name || add.isPending}>Создать</Button>
        </div>
        {inviteUrl && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 p-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{inviteUrl}</span>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            >
              <IconCopy className="mr-1 h-4 w-4" stroke={1.75} /> Копировать
            </Button>
            <p className="w-full text-[11px] text-muted-foreground">
              Приглашение владельцу (14 дней): по ссылке он создаст свой аккаунт
              и получит полный доступ к организации.
            </p>
          </div>
        )}
      </form>
    </main>
  )
}
