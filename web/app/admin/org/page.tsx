'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { IconUsersGroup, IconBuildingStore, IconTrash } from '@tabler/icons-react'
import {
  getSites, createSite, getUsers, createUser, deleteUser,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const ROLES = ['operator', 'manager', 'admin', 'super'] as const

export default function OrgPage(): React.JSX.Element {
  const qc = useQueryClient()

  const sites = useQuery({ queryKey: ['admin', 'sites'], queryFn: getSites })
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: getUsers })

  const [siteName, setSiteName] = useState('')
  const [siteAddr, setSiteAddr] = useState('')
  const addSite = useMutation({
    mutationFn: () => createSite({ name: siteName, address: siteAddr || null }),
    onSuccess: () => {
      setSiteName(''); setSiteAddr('')
      void qc.invalidateQueries({ queryKey: ['admin', 'sites'] })
    },
  })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('operator')
  const addUser = useMutation({
    mutationFn: () => createUser({ email, password, role }),
    onSuccess: () => {
      setEmail(''); setPassword(''); setRole('operator')
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
  const rmUser = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  return (
    <main className="space-y-8">
      <div className="flex items-center gap-2">
        <IconUsersGroup className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">Организация</h1>
      </div>

      {/* Sites */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <IconBuildingStore className="h-4 w-4" stroke={1.75} /> Сайты
        </h2>
        <div className="overflow-hidden rounded-lg border border-border/70">
          {sites.data?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b border-border/60 p-3 last:border-0">
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.address ?? '—'}</span>
              <span className="ml-auto text-xs text-muted-foreground">{s.timezone}</span>
            </div>
          ))}
          {sites.data?.length === 0 && <div className="p-3 text-sm text-muted-foreground">Сайтов нет.</div>}
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (siteName) addSite.mutate() }}
        >
          <div className="space-y-1">
            <Label htmlFor="site-name">Название</Label>
            <Input id="site-name" value={siteName} onChange={(e) => setSiteName(e.target.value)} className="w-48" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="site-addr">Адрес</Label>
            <Input id="site-addr" value={siteAddr} onChange={(e) => setSiteAddr(e.target.value)} className="w-56" />
          </div>
          <Button type="submit" disabled={!siteName || addSite.isPending}>Добавить сайт</Button>
        </form>
      </section>

      {/* Users */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <IconUsersGroup className="h-4 w-4" stroke={1.75} /> Пользователи
        </h2>
        <div className="overflow-hidden rounded-lg border border-border/70">
          {users.data?.map((u) => (
            <div key={u.id} className="flex items-center gap-3 border-b border-border/60 p-3 last:border-0">
              <span className="text-sm font-medium">{u.email}</span>
              <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                {u.role}
              </span>
              <Button
                size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-red-300"
                disabled={rmUser.isPending}
                onClick={() => rmUser.mutate(u.id)}
              >
                <IconTrash className="h-4 w-4" stroke={1.75} />
              </Button>
            </div>
          ))}
          {users.data?.length === 0 && <div className="p-3 text-sm text-muted-foreground">Пользователей нет.</div>}
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (email && password.length >= 8) addUser.mutate() }}
        >
          <div className="space-y-1">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-56" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-pass">Пароль (мин. 8)</Label>
            <Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label>Роль</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={!email || password.length < 8 || addUser.isPending}>
            Добавить пользователя
          </Button>
        </form>
        {addUser.isError && <p className="text-sm text-red-400">Не удалось создать (email занят?)</p>}
      </section>
    </main>
  )
}
