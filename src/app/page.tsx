import Image from 'next/image';
import CHANGELOG from '../data/changelog.json';

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

export default function HomePage() {
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 rounded-2xl bg-white p-8 shadow-lg">
        <div className="flex items-center gap-6">
          <Image alt="Camp Canteen POS logo" className="h-20 w-20" height={80} priority src="/logo-canteen.svg" width={80} />
          <div>
            <h1 className="text-3xl font-bold text-camp-700">Camp Canteen POS</h1>
            <p className="mt-1 text-sm text-gray-500">Fast, offline-capable point of sale for canteens and camps.</p>
            <div className="mt-2 text-xs text-gray-400">version {appVersion}</div>
          </div>
        </div>

        <div className="grid w-full gap-4 sm:grid-cols-3">
          <a href="/pos" className="rounded-xl bg-camp-500 py-4 text-center text-base font-semibold text-white shadow hover:bg-camp-600">
            Open POS
          </a>
          <a href="/admin" className="rounded-xl bg-gray-700 py-4 text-center text-base font-semibold text-white shadow hover:bg-gray-800">
            Admin
          </a>
          <a href="/transactions" className="rounded-xl border border-camp-500 py-4 text-center text-base font-semibold text-camp-600 shadow hover:bg-camp-50">
            Recent Transactions
          </a>
        </div>

        <div className="grid w-full gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-xl border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900">Latest Notes</h2>
            <p className="mt-1 text-sm text-gray-500">Recent release highlights and important maintenance notes.</p>
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
            <p className="mt-1 text-sm text-gray-500">Everything staff need for a busy canteen day.</p>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {FEATURE_LIST.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-camp-500" aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 text-sm text-gray-500">
              <a href="https://github.com/themakkosbox-beep/Canteen-Project-App/releases/tag/v1.3.1" className="text-camp-600 hover:underline">
                Download desktop v1.3.1
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}