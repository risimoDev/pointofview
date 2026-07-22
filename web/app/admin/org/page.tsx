'use client'

import type * as React from 'react'
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  IconUsersGroup, IconBuildingStore, IconTrash, IconLink, IconCopy, IconBan,
} from '@tabler/icons-react'
import {
  getSites, createSite, getUsers, createUser, updateUser, deleteUser,
  getInvites, createInvite, deleteInvite, getCameras, getClaims, errorMessage,
  type AdminUser, type Invite,
} from '@/lib/api'
import { PermissionCodes, RoleDefaultPerms } from '@shared/events.schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { permissionLabels, roleLabels } from '@/lib/labels'

const TENANT_ROLES = ['operator', 'manager', 'admin'] as const

/** Checkbox grid for capability codes. */
function PermPicker({ value, onChange }: {
  value: string[]; onChange: (v: string[]) => void
}): React.JSX.Element {
  const toggle = (code: string): void =>
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code])
  return (
    <div className="flex flex-wrap gap-1.5">
      {PermissionCodes.map((code) => (
        <Button
          key={code} type="button" size="sm"
          variant={value.includes(code) ? 'default' : 'outline'}
          className="h-7 text-xs"
          onClick={() => toggle(code)}
        >
          {permissionLabels[code]}
        </Button>
      ))}
    </div>
  )
}

/** Camera restriction: none selected = all cameras allowed. */
function CameraPicker({ value, onChange }: {
  value: string[]; onChange: (v: string[]) => void
}): React.JSX.Element {
  const cams = useQuery({ queryKey: ['cameras'], queryFn: getCameras })
  if (!cams.data || cams.data.length === 0) return <></>
  const toggle = (id: string): void =>
    onChange(value.includes(id) ? value.filter((c) => c !== id) : [...value, id])
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">
        Камеры (ничего не выбрано = все камеры)
      </span>
      <div className="flex flex-wrap gap-1.5">
        {cams.data.map((c) => (
          <Button
            key={c.id} type="button" size="sm"
            variant={value.includes(c.id) ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => toggle(c.id)}
          >
            {c.name}
          </Button>
        ))}
      </div>
    </div>
  )
}

function permsSummary(u: AdminUser): string {
  if (u.role === 'admin') return 'полный доступ'
  const perms = u.permissions ?? [...(RoleDefaultPerms[u.role] ?? [])]
  if (perms.length === PermissionCodes.length) return 'полный доступ'
  return perms.map((p) => permissionLabels[p] ?? p).join(', ') || 'нет доступа'
}

function UserRow({ user, isOwner, onChanged }: {
  user: AdminUser; isOwner: boolean; onChanged: () => void
}): React.JSX.Element {
  const roles = isOwner ? TENANT_ROLES : TENANT_ROLES.filter((r) => r !== 'admin')
  const [edit, setEdit] = useState(false)
  const [role, setRole] = useState(user.role)
  const [perms, setPerms] = useState<string[]>(
    user.permissions ?? [...(RoleDefaultPerms[user.role] ?? [])],
  )
  const [cams, setCams] = useState<string[]>(user.allowedCameraIds)
  const [password, setPassword] = useState('')

  const save = useMutation({
    mutationFn: () => updateUser(user.id, {
      role,
      permissions: role === 'admin' ? null : perms,
      allowed_camera_ids: cams,
      ...(password.length >= 8 ? { password } : {}),
    }),
    onSuccess: () => { setEdit(false); setPassword(''); onChanged() },
  })
  const toggleDisabled = useMutation({
    mutationFn: () => updateUser(user.id, { disabled: !user.disabled }),
    onSuccess: onChanged,
  })
  const rm = useMutation({ mutationFn: () => deleteUser(user.id), onSuccess: onChanged })

  return (
    <div className={cn('border-b border-border/60 p-3 last:border-0', user.disabled && 'opacity-50')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{user.name || user.email}</span>
        <span className="text-xs text-muted-foreground">{user.email}</span>
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
          {roleLabels[user.role as keyof typeof roleLabels] ?? user.role}
        </span>
        {user.disabled && (
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300">
            Отключён
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* super is never editable here; another owner account only by an owner
              (blocks a non-owner «users»-perm holder from disabling/deleting
              the actual owner — the API enforces this too, this just matches
              the UI to it) */}
          {user.role !== 'super' && (user.role !== 'admin' || isOwner) && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEdit((v) => !v)}>
                {edit ? 'Отмена' : 'Доступы'}
              </Button>
              <Button
                size="sm" variant="ghost" title={user.disabled ? 'Включить' : 'Отключить вход'}
                disabled={toggleDisabled.isPending}
                onClick={() => toggleDisabled.mutate()}
              >
                <IconBan className="h-4 w-4" stroke={1.75} />
              </Button>
              <Button
                size="sm" variant="ghost" className="text-muted-foreground hover:text-red-300"
                disabled={rm.isPending}
                onClick={() => {
                  if (confirm(`Удалить пользователя «${user.name || user.email}»? Он потеряет доступ навсегда. Чтобы просто закрыть вход — используйте «Отключить».`)) {
                    rm.mutate()
                  }
                }}
              >
                <IconTrash className="h-4 w-4" stroke={1.75} />
              </Button>
            </>
          )}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{permsSummary(user)}</p>
      {edit && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Роль</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>{roleLabels[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Новый пароль (пусто — не менять)</Label>
              <Input
                type="password" value={password} className="w-48"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          {role !== 'admin' && <PermPicker value={perms} onChange={setPerms} />}
          <CameraPicker value={cams} onChange={setCams} />
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            Сохранить доступы
          </Button>
          {save.isError && <p className="text-sm text-red-400">{errorMessage(save.error)}</p>}
          <p className="text-[11px] text-muted-foreground">
            Изменения прав применяются при следующем входе пользователя.
          </p>
        </div>
      )}
    </div>
  )
}

function AddUser({ isOwner, onChanged }: { isOwner: boolean; onChanged: () => void }): React.JSX.Element {
  const roles = isOwner ? TENANT_ROLES : TENANT_ROLES.filter((r) => r !== 'admin')
  const [mode, setMode] = useState<'invite' | 'password'>('invite')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>('operator')
  const [perms, setPerms] = useState<string[]>([...(RoleDefaultPerms.operator ?? [])])
  const [cams, setCams] = useState<string[]>([])
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const reset = (): void => {
    setName(''); setEmail(''); setPassword(''); setCams([])
    setPerms([...(RoleDefaultPerms.operator ?? [])]); setRole('operator')
  }

  const invite = useMutation({
    mutationFn: () => createInvite({
      name, role,
      ...(email ? { email } : {}),
      permissions: role === 'admin' ? null : perms,
      allowed_camera_ids: cams,
    }),
    onSuccess: (token) => {
      setInviteUrl(`${window.location.origin}/invite/${token}`)
      reset(); onChanged()
    },
  })
  const direct = useMutation({
    mutationFn: () => createUser({
      name, email, password, role,
      permissions: role === 'admin' ? null : perms,
      allowed_camera_ids: cams,
    }),
    onSuccess: () => { setInviteUrl(null); reset(); onChanged() },
  })

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (mode === 'invite') invite.mutate()
    else if (email && password.length >= 8) direct.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Добавить пользователя</span>
        <div className="ml-auto flex gap-1">
          <Button
            type="button" size="sm" variant={mode === 'invite' ? 'default' : 'outline'}
            onClick={() => setMode('invite')}
          >
            <IconLink className="mr-1 h-4 w-4" stroke={1.75} /> Ссылка-приглашение
          </Button>
          <Button
            type="button" size="sm" variant={mode === 'password' ? 'default' : 'outline'}
            onClick={() => setMode('password')}
          >
            Логин и пароль
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Имя</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-44" />
        </div>
        <div className="space-y-1">
          <Label>Эл. почта{mode === 'invite' ? ' (необязательно)' : ''}</Label>
          <Input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-56" required={mode === 'password'}
          />
        </div>
        {mode === 'password' && (
          <div className="space-y-1">
            <Label>Пароль (мин. 8)</Label>
            <Input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-44" required minLength={8}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label>Роль</Label>
          <Select value={role} onValueChange={(v) => {
            setRole(v)
            setPerms([...(RoleDefaultPerms[v] ?? [])])
          }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>{roleLabels[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {role !== 'admin' && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Что доступно пользователю</span>
          <PermPicker value={perms} onChange={setPerms} />
        </div>
      )}
      <CameraPicker value={cams} onChange={setCams} />

      <Button type="submit" disabled={invite.isPending || direct.isPending}>
        {mode === 'invite' ? 'Создать приглашение' : 'Создать аккаунт'}
      </Button>
      {(invite.isError || direct.isError) && (
        <p className="text-sm text-red-400">{errorMessage(invite.error ?? direct.error)}</p>
      )}

      {inviteUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 p-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{inviteUrl}</span>
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(inviteUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            <IconCopy className="mr-1 h-4 w-4" stroke={1.75} />
            {copied ? 'Скопировано' : 'Копировать'}
          </Button>
          <p className="w-full text-[11px] text-muted-foreground">
            Отправьте ссылку сотруднику любым способом — он сам задаст пароль.
            Ссылка действует 7 дней.
          </p>
        </div>
      )}
    </form>
  )
}

function InviteRow({ inv, onChanged }: { inv: Invite; onChanged: () => void }): React.JSX.Element {
  const rm = useMutation({ mutationFn: () => deleteInvite(inv.id), onSuccess: onChanged })
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${inv.token}`
  const expired = new Date(inv.expiresAt).getTime() < Date.now()
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3 text-sm last:border-0">
      <span className="font-medium">{inv.name || inv.email || 'Без имени'}</span>
      <span className="text-xs text-muted-foreground">
        {roleLabels[inv.role as keyof typeof roleLabels] ?? inv.role}
      </span>
      {inv.usedAt
        ? <span className="text-xs text-emerald-400">использовано</span>
        : expired
          ? <span className="text-xs text-red-400">истекло</span>
          : (
            <Button
              size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => void navigator.clipboard.writeText(url)}
            >
              <IconCopy className="mr-1 h-3.5 w-3.5" stroke={1.75} /> Копировать ссылку
            </Button>
          )}
      <Button
        size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-red-300"
        disabled={rm.isPending} onClick={() => rm.mutate()}
      >
        <IconTrash className="h-4 w-4" stroke={1.75} />
      </Button>
    </div>
  )
}

export default function OrgPage(): React.JSX.Element {
  const qc = useQueryClient()
  const claims = useQuery({ queryKey: ['claims'], queryFn: getClaims })
  // «users»-checkbox employees (not owners) must not be able to grant/touch
  // the admin role — see api/src/routes/admin.ts for the matching API guard
  const isOwner = claims.data?.role === 'admin' || claims.data?.role === 'super'
  const sites = useQuery({ queryKey: ['admin', 'sites'], queryFn: getSites })
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: getUsers })
  const invites = useQuery({ queryKey: ['admin', 'invites'], queryFn: getInvites })
  const onChanged = (): void => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'invites'] })
  }

  const [siteName, setSiteName] = useState('')
  const [siteAddr, setSiteAddr] = useState('')
  const addSite = useMutation({
    mutationFn: () => createSite({ name: siteName, address: siteAddr || null }),
    onSuccess: () => {
      setSiteName(''); setSiteAddr('')
      void qc.invalidateQueries({ queryKey: ['admin', 'sites'] })
    },
  })

  const pendingInvites = (invites.data ?? []).filter((i) => !i.usedAt)

  return (
    <main className="space-y-8">
      <div className="flex items-center gap-2">
        <IconUsersGroup className="h-5 w-5 text-brand" stroke={1.75} />
        <h1 className="font-display text-lg font-semibold tracking-tight">
          Организация и доступы
        </h1>
      </div>

      {/* Users */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Пользователи ({users.data?.length ?? 0})
        </h2>
        <div className="overflow-hidden rounded-lg border border-border/70">
          {users.data?.map((u) => (
            <UserRow key={u.id} user={u} isOwner={isOwner} onChanged={onChanged} />
          ))}
          {users.data?.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">Пользователей нет.</div>
          )}
        </div>
        <AddUser isOwner={isOwner} onChanged={onChanged} />
      </section>

      {/* Invites */}
      {pendingInvites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Приглашения ({pendingInvites.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-border/70">
            {pendingInvites.map((i) => <InviteRow key={i.id} inv={i} onChanged={onChanged} />)}
          </div>
        </section>
      )}

      {/* Sites */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <IconBuildingStore className="h-4 w-4" stroke={1.75} /> Площадки
        </h2>
        <div className="overflow-hidden rounded-lg border border-border/70">
          {sites.data?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b border-border/60 p-3 last:border-0">
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.address ?? '—'}</span>
              <span className="ml-auto text-xs text-muted-foreground">{s.timezone}</span>
            </div>
          ))}
          {sites.data?.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">Площадок нет.</div>
          )}
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
          <Button type="submit" disabled={!siteName || addSite.isPending}>Добавить площадку</Button>
        </form>
      </section>
    </main>
  )
}
