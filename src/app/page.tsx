const FEATURE_LIST = [
  'Prepaid customer accounts with 4-digit IDs',
  'Barcode scanning for instant purchases',
  'Complete transaction logging with CSV exports',
  'Training mode sandbox for staff practice',
  'Quick key buttons for top products',
  'Bulk customer & product imports from CSV',
  'Nightly automated database backups',
  'Auto-updating Windows desktop app',
];

const CHANGELOG = [
  {
    version: 'v1.2.0',
    date: 'November 6, 2025',
    highlights: [
      'Nightly automatic database backups with retention',
      'Manual update checks with friendlier prompts in the desktop app',
      'End-to-end database health script (`npm run test:e2e`)',
      'Polished admin quick keys and data tools layout',
    ],
  },
  {
    version: 'v1.1.0',
    date: 'October 10, 2025',
    highlights: [
      'Training checkout mode with preset campers',
      'Bulk import helpers for customers and products',
      'POS quick filters and options editor improvements',
    ],
  },
  {
    version: 'v1.0.0',
    date: 'August 28, 2025',
    highlights: [
      'Initial public release of the Camp Canteen POS',
      'Barcode-ready sales flow with customer balance tracking',
      'Electron desktop wrapper for offline-friendly installs',
    ],
  },
];

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 rounded-2xl bg-white p-8 shadow-lg">
        <img
          alt="Camp Canteen POS logo"
          className="h-20 w-20"
          src="/logo-canteen.svg"
        />
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-camp-700">Camp Canteen POS</h1>
          <p className="text-lg text-gray-600">Run the snack bar smoothly—balances, barcodes, and backups included.</p>
        </div>

        <div className="grid w-full gap-4 sm:grid-cols-3">
          <a
            href="/pos"
            className="rounded-xl bg-camp-500 py-4 text-center text-base font-semibold text-white shadow hover:bg-camp-600"
          >
            Open POS Terminal
          </a>
          <a
            href="/admin"
            className="rounded-xl bg-gray-600 py-4 text-center text-base font-semibold text-white shadow hover:bg-gray-700"
          >
            Admin Panel
          </a>
          <a
            href="/transactions"
            className="rounded-xl border border-camp-500 py-4 text-center text-base font-semibold text-camp-600 shadow hover:bg-camp-50"
          >
            Recent Transactions
          </a>
        </div>

        <div className="grid w-full gap-6 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-xl border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900">What&apos;s New</h2>
            <p className="mt-1 text-sm text-gray-500">Ship notes and maintenance highlights.</p>
            <div className="mt-4 space-y-4">
              {CHANGELOG.map((entry) => (
                <article key={entry.version} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <header className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-camp-700">{entry.version}</span>
                    <span className="text-xs uppercase tracking-wide text-gray-500">{entry.date}</span>
                  </header>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
                    {entry.highlights.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900">Feature Highlights</h2>
            <p className="mt-1 text-sm text-gray-500">Everything the staff needs for a busy canteen day.</p>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {FEATURE_LIST.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-camp-500" aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}