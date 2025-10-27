import '../styles/globals.css'
import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'

export const metadata: Metadata = {
  title: 'Camp Canteen POS',
  description: 'Point of Sale system for camp canteen with prepaid accounts',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="bg-gray-50 min-h-screen">
        <Navigation />
        <main className="pt-6">
          {children}
        </main>
      </body>
    </html>
  )
}