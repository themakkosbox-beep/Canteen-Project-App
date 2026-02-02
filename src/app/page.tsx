import Image from 'next/image';
import CHANGELOG from '../data/changelog.json';

const STAFF_PATH = [
  {
    title: 'Find the customer',
    description: 'Search by ID, scan a card, or filter by name in seconds.',
  },
  {
    title: 'Charge confidently',
    description: 'Use quick keys or barcode scan to complete the purchase.',
  },
  {
    title: 'Fix issues instantly',
    description: 'Voids and edits stay tied to a clear audit trail.',
  },
];

const MANAGER_PATH = [
  {
    label: 'Operations',
    href: '/operations',
    detail: 'Shift totals, backups, and recent activity in one panel.',
  },
  {
    label: 'Catalog',
    href: '/admin',
    detail: 'Customers, products, and quick keys in one workspace.',
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    detail: 'Discounts, feature toggles, and admin access controls.',
  },
];

const PROMISES = [
  'Runs offline with auto-backups',
  'Fast onboarding for new staff',
  'Every transaction is traceable',
  'Designed for long service lines',
];

export default function HomePage() {
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12">
      <section className="flex flex-col gap-8 border-b border-slate-200 pb-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 shadow-soft">
            <Image alt="Camp Canteen POS logo" className="h-14 w-14" height={56} priority src="/logo-canteen.svg" width={56} />
          </div>
          <div>
            <span className="badge-soft">Offline-first register · v{appVersion}</span>
            <h1 className="page-title mt-3">Camp Canteen POS</h1>
            <p className="mt-2 max-w-xl text-sm text-gray-500">
              Built for long lines and quick decisions. Track balances, capture sales, and close out with confidence.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
              {PROMISES.map((item) => (
                <span key={item} className="pill">{item}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-md lg:grid-cols-1">
          <a href="/pos" className="pos-button text-center text-sm">
            Open Register
          </a>
          <a href="/operations" className="rounded-full border border-emerald-100 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100">
            Daily Operations
          </a>
          <a href="/admin/settings" className="rounded-full border border-gray-200 bg-white px-4 py-3 text-center text-sm font-semibold text-gray-700 transition hover:border-emerald-200 hover:text-emerald-700">
            Manager Settings
          </a>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="border-b border-slate-200 pb-8">
          <div className="flex flex-col gap-1">
            <h2 className="section-title">Staff flow</h2>
            <p className="text-sm text-gray-500">What the register team does every shift.</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {STAFF_PATH.map((workflow) => (
              <div key={workflow.title} className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <p className="text-sm font-semibold text-gray-800">{workflow.title}</p>
                <p className="mt-2 text-xs text-gray-500">{workflow.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-slate-200 pb-8">
          <div className="flex flex-col gap-1">
            <h2 className="section-title">Manager workspace</h2>
            <p className="text-sm text-gray-500">Everything to keep data safe and balanced.</p>
          </div>
          <div className="mt-5 space-y-3">
            {MANAGER_PATH.map((tool) => (
              <a
                key={tool.href}
                href={tool.href}
                className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white/80 p-4 transition hover:border-emerald-200"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800">{tool.label}</p>
                  <p className="text-xs text-gray-500">{tool.detail}</p>
                </div>
                <span className="text-xs font-semibold text-emerald-600">Open</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="border-b border-slate-200 pb-8">
          <div className="flex flex-col gap-1">
            <h2 className="section-title">Release notes</h2>
            <p className="text-sm text-gray-500">What changed most recently.</p>
          </div>
          <div className="mt-5 space-y-4">
            {CHANGELOG.slice(0, 2).map((entry) => (
              <article key={entry.version} className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <header className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-emerald-700">{entry.version}</span>
                  <span className="text-xs uppercase tracking-wide text-gray-400">{entry.date}</span>
                </header>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-600">
                  {entry.highlights.slice(0, 3).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>

        <div className="border-b border-slate-200 pb-8">
          <div className="flex flex-col gap-1">
            <h2 className="section-title">Shift checklist</h2>
            <p className="text-sm text-gray-500">Suggested steps for every camp day.</p>
          </div>
          <ol className="mt-5 space-y-3 text-sm text-gray-600">
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Confirm customer cards or ID sheet are ready.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Review quick keys and top items for the day.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Run mid-day backup if the line slows down.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Close out with Operations totals and export if needed.
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
