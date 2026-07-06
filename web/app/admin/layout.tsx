import type * as React from 'react'
import type { ReactNode } from 'react'
import { AdminNav } from '@/components/admin-nav'

export default function AdminLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
      <AdminNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
