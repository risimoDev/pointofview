import type { Metadata } from 'next'
import type * as React from 'react'
import type { ReactNode } from 'react'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { AppNav } from '@/components/app-nav'

// Distinctive display face for the wordmark/headings (not the default Inter).
const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'BZK-VIZIAI',
  description: 'VMS видеоаналитика',
}

// Auth guard is enforced in middleware.ts (cookie check + redirect).
export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="ru" suppressHydrationWarning className={`dark ${display.variable}`}>
      <head>
        {/* Apply stored theme before paint to avoid a flash; dark is default. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('theme')==='light'){var d=document.documentElement;d.classList.remove('dark');d.classList.add('light')}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>
          <AppNav />
          {children}
        </Providers>
      </body>
    </html>
  )
}
