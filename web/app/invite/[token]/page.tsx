'use client'

import type * as React from 'react'
import { use, useEffect, useState } from 'react'
import { IconShieldCheck } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface InviteInfo {
  name: string
  email: string | null
  orgName: string
}

export default function InvitePage(
  { params }: { params: Promise<{ token: string }> },
): React.JSX.Element {
  const { token } = use(params)
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    fetch(`/api/v1/public/invite/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error()
        const d = (await r.json()) as InviteInfo
        setInfo(d)
        setEmail(d.email ?? '')
        setName(d.name)
      })
      .catch(() => setError('Приглашение не найдено или срок его действия истёк.'))
  }, [token])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (password !== password2) { setError('Пароли не совпадают'); return }
    setPending(true)
    setError(null)
    const res = await fetch(`/api/v1/public/invite/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: name || undefined }),
    }).catch(() => null)
    setPending(false)
    if (res?.ok) { setDone(true); return }
    const body = res ? (await res.json().catch(() => null)) as { message?: string } | null : null
    setError(body?.message ?? 'Не удалось создать аккаунт, попробуйте позже.')
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border/70 bg-card/70 p-7 backdrop-blur">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/30">
            <IconShieldCheck className="h-6 w-6" stroke={1.8} />
          </span>
          <div className="space-y-0.5">
            <h1 className="font-display text-xl font-semibold tracking-tight">Приглашение</h1>
            {info && (
              <p className="text-sm text-muted-foreground">
                Организация «{info.orgName}» приглашает вас в систему видеонаблюдения.
              </p>
            )}
          </div>
        </div>

        {done ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-emerald-400">Аккаунт создан.</p>
            <Button asChild className="w-full"><a href="/login">Войти</a></Button>
          </div>
        ) : info ? (
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Имя</Label>
              <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Эл. почта (логин)</Label>
              <Input
                id="inv-email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-pass">Пароль (мин. 8 символов)</Label>
              <Input
                id="inv-pass" type="password" required minLength={8} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-pass2">Пароль ещё раз</Label>
              <Input
                id="inv-pass2" type="password" required value={password2}
                onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              Создать аккаунт
            </Button>
          </form>
        ) : (
          <p className="text-center text-sm text-red-400">{error ?? 'Загрузка…'}</p>
        )}
      </div>
    </main>
  )
}
