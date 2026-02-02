'use client';

import React, { useMemo, useState } from 'react';
import { Dialog } from '@headlessui/react';
import type { TransactionExportRow } from '@/types/database';

interface BalanceEditModalState {
  open: boolean;
  transaction: TransactionExportRow | null;
  amount: string;
  note: string;
  error: string | null;
  submitting: boolean;
}

const createEmptyBalanceEditModalState = (): BalanceEditModalState => ({
  open: false,
  transaction: null,
  amount: '',
  note: '',
  error: null,
  submitting: false,
});

interface RecentTransactionsTableProps {
  initialTransactions: TransactionExportRow[];
}

const formatTimestamp = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
};

const noteForEntry = (entry: TransactionExportRow): string | null => {
  if (entry.edit_parent_transaction_id) {
    return entry.note ? `Edit: ${entry.note}` : 'Edit';
  }
  return entry.note ?? null;
};

const typeLabelForEntry = (entry: TransactionExportRow): { primary: string; secondary?: string | null } => {
  if (entry.edit_parent_transaction_id) {
    const base = entry.type === 'purchase'
      ? entry.product_name ?? 'Purchase'
      : entry.type === 'deposit'
      ? 'Deposit'
      : entry.type === 'adjustment'
      ? 'Adjustment'
      : entry.type;
    return { primary: 'Edit', secondary: base };
  }

  if (entry.type === 'purchase') {
    return { primary: entry.product_name ?? 'Purchase', secondary: entry.product_id ?? null };
  }

  if (entry.type === 'deposit') {
    return { primary: 'Deposit' };
  }

  if (entry.type === 'adjustment') {
    return { primary: 'Adjustment' };
  }

  return { primary: entry.type };
};

const RecentTransactionsTable: React.FC<RecentTransactionsTableProps> = ({ initialTransactions }) => {
  const [transactions, setTransactions] = useState<TransactionExportRow[]>(initialTransactions);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceEditModalState, setBalanceEditModalState] = useState<BalanceEditModalState>(() =>
    createEmptyBalanceEditModalState()
  );

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    []
  );

  const openBalanceEditModal = (transaction: TransactionExportRow) => {
    if (transaction.voided || (transaction.type !== 'deposit' && transaction.type !== 'adjustment')) {
      return;
    }

    const initialAmount = Number.isFinite(transaction.amount)
      ? (Math.round(transaction.amount * 100) / 100).toString()
      : '';

    setBalanceEditModalState({
      ...createEmptyBalanceEditModalState(),
      open: true,
      transaction,
      amount: initialAmount,
      note: transaction.note ?? '',
    });
  };

  const closeBalanceEditModal = () => {
    setBalanceEditModalState((prev) => {
      if (prev.submitting) {
        return prev;
      }
      return createEmptyBalanceEditModalState();
    });
  };

  const refreshTransactions = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/transactions/list?limit=50', { cache: 'no-cache' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as { error?: string })?.error ?? 'Failed to refresh transactions');
      }

      const payload = (await response.json()) as { transactions?: TransactionExportRow[] };
      const data = Array.isArray(payload.transactions) ? payload.transactions : [];
      setTransactions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh transactions');
    } finally {
      setRefreshing(false);
    }
  };

  const handleBalanceEditSubmit = async () => {
    if (!balanceEditModalState.open || !balanceEditModalState.transaction) {
      return;
    }

    const transactionId = balanceEditModalState.transaction.transaction_id;
    const parsedAmount = Number.parseFloat(balanceEditModalState.amount);

    if (!Number.isFinite(parsedAmount)) {
      setBalanceEditModalState((prev) => ({ ...prev, error: 'Enter a valid amount.' }));
      return;
    }

    setBalanceEditModalState((prev) => ({ ...prev, submitting: true, error: null }));
    setError(null);

    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionType: 'balance-delta',
          customerId: balanceEditModalState.transaction.customer_id,
          amount: parsedAmount,
          note: balanceEditModalState.note.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as { error?: string })?.error ?? 'Failed to update transaction');
      }

      await refreshTransactions();
      closeBalanceEditModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update transaction';
      setBalanceEditModalState((prev) => ({ ...prev, submitting: false, error: message }));
      setError((prevError) => prevError ?? message);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-6 shadow space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Latest Activity</h2>
          <p className="text-sm text-gray-600">Edit deposits and adjustments in place.</p>
        </div>
        <button
          type="button"
          onClick={refreshTransactions}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-emerald-500 disabled:opacity-60"
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">Timestamp</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Balance After</th>
              <th className="px-3 py-2 text-left">Note</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  No transactions recorded yet.
                </td>
              </tr>
            ) : (
              transactions.map((entry) => {
                const typeLabels = typeLabelForEntry(entry);
                const note = noteForEntry(entry);
                const canEditBalanceDelta =
                  !entry.voided && (entry.type === 'deposit' || entry.type === 'adjustment');
                const amountPositive = entry.amount >= 0;

                return (
                  <tr key={entry.transaction_id ?? `${entry.customer_id}-${entry.timestamp}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatTimestamp(entry.timestamp)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">
                        {entry.customer_name ?? '-'}
                      </div>
                      <div className="text-xs text-gray-500">ID: {entry.customer_id ?? 'n/a'}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <div className="font-semibold text-gray-800">{typeLabels.primary}</div>
                      {typeLabels.secondary ? (
                        <div className="text-xs text-gray-500">{typeLabels.secondary}</div>
                      ) : null}
                      {entry.edit_parent_transaction_id ? (
                        <span className="mt-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Edited
                        </span>
                      ) : null}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${amountPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                      {amountPositive
                        ? `+${currencyFormatter.format(entry.amount)}`
                        : `-${currencyFormatter.format(Math.abs(entry.amount))}`}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {currencyFormatter.format(entry.balance_after)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{note ?? '-'}</td>
                    <td className="px-3 py-2">
                      {canEditBalanceDelta ? (
                        <button
                          type="button"
                          onClick={() => openBalanceEditModal(entry)}
                          className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm hover:border-emerald-400 hover:text-emerald-700"
                        >
                          Edit
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={balanceEditModalState.open} onClose={closeBalanceEditModal}>
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            {balanceEditModalState.transaction ? (
              <>
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Edit {balanceEditModalState.transaction.type === 'deposit' ? 'Deposit' : 'Adjustment'}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-gray-500">
                  Update the amount or note for this balance change.
                </Dialog.Description>

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="balance-edit-amount-admin">
                      Amount
                    </label>
                    <input
                      id="balance-edit-amount-admin"
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      min="-1000"
                      className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-base shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      value={balanceEditModalState.amount}
                      disabled={balanceEditModalState.submitting}
                      onChange={(event) =>
                        setBalanceEditModalState((prev) => ({ ...prev, amount: event.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="balance-edit-note-admin">
                      Note (optional)
                    </label>
                    <textarea
                      id="balance-edit-note-admin"
                      rows={3}
                      className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      value={balanceEditModalState.note}
                      disabled={balanceEditModalState.submitting}
                      onChange={(event) =>
                        setBalanceEditModalState((prev) => ({ ...prev, note: event.target.value }))
                      }
                    />
                  </div>

                  {balanceEditModalState.error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {balanceEditModalState.error}
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm hover:border-gray-400"
                      disabled={balanceEditModalState.submitting}
                      onClick={closeBalanceEditModal}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                      disabled={balanceEditModalState.submitting}
                      onClick={() => void handleBalanceEditSubmit()}
                    >
                      {balanceEditModalState.submitting ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </Dialog.Panel>
        </div>
      </Dialog>
    </section>
  );
};

export default RecentTransactionsTable;
