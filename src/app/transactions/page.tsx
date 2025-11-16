import Link from 'next/link';
import DatabaseManager from '@/lib/database';
import RecentTransactionsTable from './recent-transactions-table';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function RecentTransactionsPage() {
  const database = DatabaseManager.getInstance();
  const allTransactions = await database.listAllTransactions();
  const recent = allTransactions.slice(0, 50);

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="mx-auto max-w-6xl space-y-6 px-4">
        <header className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-camp-700">Recent Transactions</h1>
              <p className="text-sm text-gray-600">
                The latest activity across deposits, purchases, and adjustments.
              </p>
            </div>
            <Link
              href="/"
              className="rounded-lg border border-camp-500 px-3 py-2 text-sm font-semibold text-camp-600 hover:bg-camp-50"
            >
              Back to home
            </Link>
          </div>
          <p className="text-xs text-gray-500">
            Showing the 50 most recent entries. Export the full history from the Admin &raquo; Data Tools section.
          </p>
        </header>

        <RecentTransactionsTable initialTransactions={recent} />
      </div>
    </div>
  );
}
