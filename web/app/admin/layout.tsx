import type * as React from 'react'
import type { ReactNode } from 'react'

// The admin sub-navigation moved into the console rail (components/app-shell)
// — it was a second permission-gated list of the same pages and the two drifted.
// This layout keeps the reading width and the page padding the admin screens
// rely on (they render a bare `space-y-*` column).
export default function AdminLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="mx-auto w-full max-w-6xl p-4 sm:p-5">{children}</div>
}
