import Link from 'next/link';
import DatabaseManager from '@/lib/database';
import RecentTransactionsTable from './recent-transactions-table';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RecentTransactionsPage() {
  const database = DatabaseManager.getInstance();
  const recent = await database.listAllTransactions(50);

  return (
    <div className="min-h-screen py-10">
      <div className="mx-auto max-w-6xl space-y-8 px-4">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600">Transaction log</p>
              <h1 className="page-title mt-2">Activity history</h1>
              <p className="text-sm text-gray-500">
                Track every sale, deposit, and adjustment with audit details.
              </p>
            </div>
            <Link
              href="/"
              className="rounded-full border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Back to dashboard
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="pill">Showing the 50 most recent entries</span>
            <span className="pill">Export full history in Settings → Data Tools</span>
          </div>
          <p className="text-xs text-gray-500">
            Use edit and void tools below for corrections. All changes remain traceable.
          </p>
        </header>

        <RecentTransactionsTable initialTransactions={recent} />
      </div>
    </div>
  );
}
