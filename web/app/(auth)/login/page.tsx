import type * as React from 'react'
import { IconShieldCheck } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default async function LoginPage(
  { searchParams }: { searchParams: Promise<{ error?: string }> },
): Promise<React.JSX.Element> {
  const { error } = await searchParams
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-brand/10 blur-[120px]"
      />
      <form
        action="/api/auth/login"
        method="post"
        className="relative w-full max-w-sm space-y-5 rounded-2xl border border-border/70 bg-card/70 p-7 shadow-glow backdrop-blur"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/30">
            <IconShieldCheck className="h-6 w-6" stroke={1.8} />
          </span>
          <div className="space-y-0.5">
            <h1 className="font-display text-xl font-semibold tracking-tight">
              BZK-VIZI<span className="text-brand">AI</span>
            </h1>
            <p className="text-sm text-muted-foreground">Вход в систему видеоаналитики</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Эл. почта</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Пароль</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {error && (
          <p className="text-center text-sm text-red-400">
            {error === 'rate'
              ? 'Слишком много попыток входа. Попробуйте позже.'
              : 'Неверная почта или пароль.'}
          </p>
        )}
        <Button type="submit" className="w-full">Войти</Button>
      </form>
    </main>
  )
}
