import DatabaseManager from '@/lib/database';
import type { TransactionExportRow, TransactionStatsSummary } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return 'Not available';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const buildStats = (stats: TransactionStatsSummary) => [
  { label: 'Purchases', value: stats.totalPurchases },
  { label: 'Deposits', value: stats.totalDeposits },
  { label: 'Adjustments', value: stats.totalAdjustments },
  { label: 'Voids', value: stats.voidedTransactions },
];

const buildTotals = (stats: TransactionStatsSummary) => [
  { label: 'Sales total', value: formatCurrency(stats.totalAmountPurchases) },
  { label: 'Deposits total', value: formatCurrency(stats.totalAmountDeposits) },
  { label: 'Adjustments total', value: formatCurrency(stats.totalAmountAdjustments) },
  { label: 'Withdrawals total', value: formatCurrency(stats.totalAmountWithdrawals) },
];

const getTransactionLabel = (transaction: TransactionExportRow) => {
  if (transaction.type === 'purchase') {
    return transaction.product_name ?? 'Purchase';
  }
  if (transaction.type === 'deposit') {
    return 'Deposit';
  }
  if (transaction.type === 'withdrawal') {
    return 'Withdrawal';
  }
  return 'Adjustment';
};

export default async function OperationsPage() {
  const database = DatabaseManager.getInstance();
  const [stats, recent, backupStatus] = await Promise.all([
    database.getTransactionStatsSummary(),
    database.listAllTransactions(8),
    database.getBackupStatus(),
  ]);

  return (
    <div className="min-h-screen py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600">Operations</p>
              <h1 className="page-title mt-2">Manager command center</h1>
              <p className="text-sm text-gray-500">
                Daily totals, backup health, and recent activity in one view.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white/80 flex flex-col gap-1 px-4 py-3 text-sm text-gray-600">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                Last transaction
              </span>
              <span className="text-sm font-semibold text-gray-700">
                {formatTimestamp(stats.lastTransactionAt)}
              </span>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[0.55fr_0.45fr]">
          <div className="border-b border-slate-200 pb-8">
            <div className="flex flex-col gap-1">
              <h2 className="section-title">Activity totals</h2>
              <p className="text-sm text-gray-500">Counts and totals across all transactions.</p>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {buildStats(stats).map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-white/80 p-4">
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-gray-800">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {buildTotals(stats).map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <span className="text-sm text-gray-600">{item.label}</span>
                  <span className="text-sm font-semibold text-gray-800">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-b border-slate-200 pb-8">
            <div className="flex flex-col gap-1">
              <h2 className="section-title">Backup status</h2>
              <p className="text-sm text-gray-500">Keep offline data safe and recoverable.</p>
            </div>
            <div className="mt-5 space-y-4 text-sm text-gray-600">
              <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Last backup</p>
                <p className="mt-2 text-sm font-semibold text-gray-800">
                  {formatTimestamp(backupStatus.lastBackupAt)}
                </p>
                {backupStatus.lastBackupFile ? (
                  <p className="mt-1 text-xs text-gray-500">{backupStatus.lastBackupFile}</p>
                ) : null}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Last restore</p>
                <p className="mt-2 text-sm font-semibold text-gray-800">
                  {formatTimestamp(backupStatus.lastRestoreAt)}
                </p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-xs text-emerald-700">
                Backups are stored locally at <span className="font-semibold">{backupStatus.backupDirectory}</span>.
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 pb-8">
          <div className="flex flex-col gap-1">
            <h2 className="section-title">Recent activity</h2>
            <p className="text-sm text-gray-500">
              Quick view of the latest transactions. Visit the full log for edits and exports.
            </p>
          </div>
          <div className="mt-5 space-y-3">
            {recent.map((transaction) => {
              const label = getTransactionLabel(transaction);
              const amountPositive = transaction.amount >= 0;
              return (
                <div
                  key={transaction.transaction_id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{label}</p>
                    <p className="text-xs text-gray-500">
                      {transaction.customer_name ?? 'Unknown'} · {transaction.customer_id}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${amountPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {amountPositive
                        ? `+${formatCurrency(transaction.amount)}`
                        : `-${formatCurrency(Math.abs(transaction.amount))}`}
                    </p>
                    <p className="text-xs text-gray-500">{formatTimestamp(transaction.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
