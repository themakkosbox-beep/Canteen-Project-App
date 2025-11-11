import '../styles/globals.css'
import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import DatabaseManager from '@/lib/database'

export const metadata: Metadata = {
  title: 'Camp Canteen POS',
  description: 'Point of Sale system for camp canteen with prepaid accounts',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
  let brandName = 'Camp Canteen POS';
  try {
    const database = DatabaseManager.getInstance();
    const appSettings = await database.getAppSettings();
    brandName = appSettings.brandName;
  } catch (error) {
    console.error('Failed to load navigation settings, using defaults.', error);
  }

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="bg-gray-50 min-h-screen">
        <Navigation brandName={brandName} />
        <main className="pt-6">
          {children}
        </main>
        <div className="pointer-events-none fixed bottom-2 right-3 text-xs font-medium text-gray-300">
          v{appVersion}
        </div>
      </body>
    </html>
  )
}