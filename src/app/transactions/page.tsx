import Link from 'next/link';
import DatabaseManager from '@/lib/database';
import type { TransactionExportRow } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const formatCurrency = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
};

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

        <section className="rounded-2xl bg-white p-6 shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Balance After</th>
                  <th className="px-3 py-2 text-left">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      No transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  recent.map((entry: TransactionExportRow) => (
                    <tr key={entry.transaction_id ?? `${entry.customer_id}-${entry.timestamp}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatTimestamp(entry.timestamp)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">
                          {entry.customer_name ?? '—'}
                        </div>
                        <div className="text-xs text-gray-500">ID: {entry.customer_id ?? 'n/a'}</div>
                      </td>
                      <td className="px-3 py-2 capitalize text-gray-700">{entry.type}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {entry.product_name ?? '—'}
                        {entry.product_id ? (
                          <span className="block text-xs text-gray-500">{entry.product_id}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800">{formatCurrency(entry.amount)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(entry.balance_after)}</td>
                      <td className="px-3 py-2 text-gray-600">{entry.note ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
