import type * as React from 'react'
import type { ReactNode } from 'react'
import { AdminNav } from '@/components/admin-nav'

export default function AdminLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-6xl gap-6 p-6">
      <AdminNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
