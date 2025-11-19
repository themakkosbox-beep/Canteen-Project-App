'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LockClosedIcon,
  ArrowPathIcon,
  BanknotesIcon,
  CreditCardIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  NoSymbolIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import type { AppSettingsPayload, TransactionStatsSummary } from '@/types/database';

interface SettingsFormState {
  brandName: string;
  globalDiscountPercent: string;
  globalDiscountFlat: string;
  newAdminCode: string;
  currentAdminCode: string;
  clearAdminCode: boolean;
}

const defaultFormState: SettingsFormState = {
  brandName: '',
  globalDiscountPercent: '',
  globalDiscountFlat: '',
  newAdminCode: '',
  currentAdminCode: '',
  clearAdminCode: false,
};

const formatNumberInput = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }
  return (Math.round(value * 100) / 100).toString();
};

const StatsSkeleton = () => (
  <div className="animate-pulse space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      <div className="h-32 rounded-lg bg-gray-200"></div>
      <div className="h-32 rounded-lg bg-gray-200"></div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-24 rounded-lg bg-gray-200"></div>
      ))}
    </div>
  </div>
);

const SettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adminCodeSet, setAdminCodeSet] = useState(false);
  const [form, setForm] = useState<SettingsFormState>(defaultFormState);
  const [adminSessionCode, setAdminSessionCode] = useState<string | null>(null);
  const [requiresAdminCode, setRequiresAdminCode] = useState(false);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [transactionStats, setTransactionStats] = useState<TransactionStatsSummary | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    []
  );

  const loadTransactionStats = useCallback(
    async (overrideCode?: string | null) => {
      const candidate = (overrideCode ?? adminSessionCode ?? '').trim();
      if (requiresAdminCode && !candidate) {
        setTransactionStats(null);
        setStatsError('Enter the admin code to view transaction totals.');
        return;
      }

      setLoadingStats(true);
      setStatsError(null);

      try {
        const response = await fetch('/api/transactions/stats', {
          headers: candidate ? { 'x-admin-code': candidate } : undefined,
        });

        if (response.status === 401) {
          setTransactionStats(null);
          setStatsError('Admin code required to view statistics.');
          setRequiresAdminCode(true);
          setAdminSessionCode(null);
          setUnlockError('Admin code expired. Please enter it again to continue.');
          return;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? 'Failed to load statistics');
        }

        const data: TransactionStatsSummary = await response.json();
        setTransactionStats(data);
      } catch (err) {
        console.error(err);
        setTransactionStats(null);
        setStatsError(err instanceof Error ? err.message : 'Failed to load statistics');
      } finally {
        setLoadingStats(false);
      }
    },
    [adminSessionCode, requiresAdminCode]
  );

  const loadSettings = useCallback(
    async (overrideCode?: string | null): Promise<boolean> => {
      setLoading(true);
      setError(null);
      if (overrideCode !== undefined) {
        setUnlockError(null);
      }

      const candidate = (overrideCode ?? adminSessionCode ?? '').trim();

      try {
        const response = await fetch('/api/settings/app', {
          headers: candidate ? { 'x-admin-code': candidate } : undefined,
        });

        if (response.status === 401) {
          const payload = await response.json().catch(() => ({}));
          if (payload?.adminCodeRequired) {
            setRequiresAdminCode(true);
            setAdminSessionCode(null);
            setTransactionStats(null);
            setStatsError('Enter the admin code to view transaction totals.');
            if (overrideCode !== undefined) {
              setUnlockError('Incorrect admin code. Try again.');
            }
            return false;
          }
          throw new Error(payload?.error ?? 'Unable to load settings');
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? 'Unable to load settings');
        }

        const data: AppSettingsPayload = await response.json();
        const resolvedCode = data.adminCodeSet ? candidate || adminSessionCode || '' : '';

        setAdminCodeSet(data.adminCodeSet);
        setForm({
          brandName: data.brandName,
          globalDiscountPercent: formatNumberInput(data.globalDiscountPercent),
          globalDiscountFlat: formatNumberInput(data.globalDiscountFlat),
          newAdminCode: '',
          currentAdminCode: data.adminCodeSet ? resolvedCode : '',
          clearAdminCode: false,
        });

        setRequiresAdminCode(false);
        setAdminSessionCode(resolvedCode ? resolvedCode : null);
        setUnlockCode('');
        setUnlockError(null);
        void loadTransactionStats(resolvedCode || null);
        return true;
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [adminSessionCode, loadTransactionStats]
  );

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!success) {
      return;
    }
    const timeout = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timeout);
  }, [success]);

  const handleUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = unlockCode.trim();
    if (!candidate) {
      setUnlockError('Enter the admin code to continue.');
      return;
    }

    setUnlocking(true);
    await loadSettings(candidate);
    setUnlocking(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (adminCodeSet && form.currentAdminCode.trim().length === 0 && !form.clearAdminCode) {
      setError('Enter the current admin code to apply changes.');
      return;
    }

    if (form.newAdminCode.trim().length > 0 && form.newAdminCode.trim().length < 4) {
      setError('New admin code must be at least 4 characters.');
      return;
    }

    const percentInput = form.globalDiscountPercent.trim();
    const flatInput = form.globalDiscountFlat.trim();
    const parsedPercent = percentInput.length ? Number.parseFloat(percentInput) : 0;
    const parsedFlat = flatInput.length ? Number.parseFloat(flatInput) : 0;

    if (Number.isNaN(parsedPercent) || parsedPercent < 0 || parsedPercent > 100) {
      setError('Discount percent must be between 0 and 100.');
      return;
    }

    if (Number.isNaN(parsedFlat) || parsedFlat < 0) {
      setError('Discount amount must be zero or greater.');
      return;
    }

    const payload: Record<string, unknown> = {
      brandName: form.brandName.trim(),
      globalDiscountPercent: parsedPercent,
      globalDiscountFlat: parsedFlat,
    };

    if (adminCodeSet) {
      payload.currentAdminCode = form.currentAdminCode.trim();
    }

    if (form.clearAdminCode) {
      payload.clearAdminCode = true;
    } else if (form.newAdminCode.trim().length > 0) {
      payload.adminCode = form.newAdminCode.trim();
    }

    setSaving(true);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (adminSessionCode) {
        headers['x-admin-code'] = adminSessionCode;
      }

      const response = await fetch('/api/settings/app', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const payloadResponse = await response.json().catch(() => null);
      if (!response.ok || !payloadResponse) {
        throw new Error((payloadResponse as { error?: string })?.error ?? 'Failed to save settings');
      }

      const data = payloadResponse as AppSettingsPayload;
      const trimmedCurrentCode = form.currentAdminCode.trim();
      const trimmedNewCode = form.newAdminCode.trim();
      const resolvedCode = data.adminCodeSet
        ? trimmedNewCode.length > 0
          ? trimmedNewCode
          : trimmedCurrentCode.length > 0
          ? trimmedCurrentCode
          : adminSessionCode ?? null
        : null;

      setAdminCodeSet(data.adminCodeSet);
      setForm({
        brandName: data.brandName,
        globalDiscountPercent: formatNumberInput(data.globalDiscountPercent),
        globalDiscountFlat: formatNumberInput(data.globalDiscountFlat),
        newAdminCode: '',
        currentAdminCode: data.adminCodeSet ? (resolvedCode ?? '') : '',
        clearAdminCode: false,
      });
      setAdminSessionCode(resolvedCode ?? null);
      setRequiresAdminCode(Boolean(data.adminCodeSet && !resolvedCode));
      void loadTransactionStats(resolvedCode ?? null);
      setSuccess('Settings updated successfully.');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleResetBrand = () => {
    setForm((previous) => ({
      ...previous,
      brandName: '',
    }));
  };

  const handleClearAdminCode = () => {
    setForm((previous) => ({
      ...previous,
      clearAdminCode: true,
      newAdminCode: '',
    }));
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="mx-auto max-w-4xl space-y-6 px-4">
        <header className="rounded-xl bg-white p-6 shadow">
          <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Customize the brand, tune account-wide discounts, and manage the admin access code.
          </p>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
            {success}
          </div>
        ) : null}

        {requiresAdminCode && !adminSessionCode ? (
          <section className="rounded-xl bg-white p-8 shadow border border-gray-100 text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <LockClosedIcon className="h-8 w-8 text-gray-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">Admin Access Required</h2>
              <p className="text-gray-600 max-w-md mx-auto">
                To view transaction statistics and manage application settings, please enter the secure admin code.
              </p>
            </div>
            <form className="mx-auto max-w-xs space-y-4" onSubmit={handleUnlock}>
              <div>
                <label className="sr-only" htmlFor="unlockCode">
                  Admin code
                </label>
                <input
                  id="unlockCode"
                  type="password"
                  value={unlockCode}
                  onChange={(event) => setUnlockCode(event.target.value)}
                  className="pos-input w-full text-center tracking-widest"
                  placeholder="Enter Admin Code"
                  disabled={unlocking}
                  autoFocus
                />
              </div>
              {unlockError ? (
                <p className="text-sm text-red-600 bg-red-50 py-1 px-2 rounded">{unlockError}</p>
              ) : null}
              <button
                type="submit"
                className="pos-button w-full justify-center"
                disabled={unlocking || unlockCode.trim().length === 0}
              >
                {unlocking ? 'Verifying...' : 'Unlock Dashboard'}
              </button>
            </form>
          </section>
        ) : (
          <>
            <section className="rounded-xl bg-white p-6 shadow border border-gray-100 space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                    <BanknotesIcon className="h-6 w-6 text-gray-500" />
                    Transaction Snapshot
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Overview of all financial activity in the system.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {transactionStats?.lastTransactionAt
                      ? `Updated ${new Date(transactionStats.lastTransactionAt).toLocaleTimeString()}`
                      : ''}
                  </span>
                  <button
                    onClick={() => void loadTransactionStats()}
                    disabled={loadingStats}
                    className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    title="Refresh stats"
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${loadingStats ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {statsError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
                  <NoSymbolIcon className="h-5 w-5" />
                  {statsError}
                </div>
              ) : loadingStats && !transactionStats ? (
                <StatsSkeleton />
              ) : transactionStats ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                          <CreditCardIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium uppercase tracking-wide text-blue-900">Total Transactions</p>
                      </div>
                      <p className="text-4xl font-bold text-gray-900">
                        {transactionStats.totalTransactions.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        All recorded system activities
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-5">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-gray-200 rounded-lg text-gray-600">
                          <NoSymbolIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium uppercase tracking-wide text-gray-600">Voided Entries</p>
                      </div>
                      <p className="text-4xl font-bold text-gray-900">
                        {transactionStats.voidedTransactions.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Cancelled or reverted actions
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-gray-200 p-4 bg-white hover:border-green-300 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-500">Deposits</p>
                        <ArrowTrendingUpIcon className="h-4 w-4 text-green-500" />
                      </div>
                      <p className="text-2xl font-semibold text-gray-900">
                        {currencyFormatter.format(transactionStats.totalAmountDeposits)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {transactionStats.totalDeposits.toLocaleString()} transactions
                      </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 p-4 bg-white hover:border-red-300 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-500">Purchases</p>
                        <CreditCardIcon className="h-4 w-4 text-red-500" />
                      </div>
                      <p className="text-2xl font-semibold text-gray-900">
                        {currencyFormatter.format(transactionStats.totalAmountPurchases)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {transactionStats.totalPurchases.toLocaleString()} transactions
                      </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 p-4 bg-white hover:border-orange-300 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-500">Withdrawals</p>
                        <ArrowTrendingDownIcon className="h-4 w-4 text-orange-500" />
                      </div>
                      <p className="text-2xl font-semibold text-gray-900">
                        {currencyFormatter.format(transactionStats.totalAmountWithdrawals)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {transactionStats.totalWithdrawals.toLocaleString()} transactions
                      </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 p-4 bg-white hover:border-gray-300 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-500">Adjustments</p>
                        <ShieldCheckIcon className="h-4 w-4 text-gray-500" />
                      </div>
                      <p className="text-2xl font-semibold text-gray-900">
                        {currencyFormatter.format(transactionStats.totalAmountAdjustments)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {transactionStats.totalAdjustments.toLocaleString()} transactions
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                  <p className="text-gray-500">No transaction data available.</p>
                </div>
              )}
            </section>

            <section className="rounded-xl bg-white p-6 shadow">
              {loading ? (
                <p className="text-sm text-gray-500">Loading settings…</p>
              ) : (
                <form className="space-y-8" onSubmit={handleSubmit}>
                  <fieldset className="space-y-4">
                    <legend className="text-lg font-semibold text-gray-900">Branding</legend>
                    <p className="text-sm text-gray-600">
                      Update the display name that appears in the header and desktop title bar. Leave blank to use the default.
                    </p>
                    <div className="flex flex-col gap-2 md:flex-row md:items-end">
                      <div className="flex-1">
                        <label className="text-sm font-medium text-gray-700" htmlFor="brandName">
                          Brand name
                        </label>
                        <input
                          id="brandName"
                          value={form.brandName}
                          onChange={(event) =>
                            setForm((previous) => ({ ...previous, brandName: event.target.value }))
                          }
                          className="pos-input mt-1 w-full"
                          placeholder="Camp Canteen POS"
                        />
                      </div>
                      <button
                        type="button"
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-camp-500"
                        onClick={handleResetBrand}
                      >
                        Reset to default
                      </button>
                    </div>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="text-lg font-semibold text-gray-900">Account-wide Discount</legend>
                    <p className="text-sm text-gray-600">
                      These values are applied to every purchase before product and customer-specific discounts.
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="discountPercent">
                          Discount percent
                        </label>
                        <input
                          id="discountPercent"
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          value={form.globalDiscountPercent}
                          onChange={(event) =>
                            setForm((previous) => ({
                              ...previous,
                              globalDiscountPercent: event.target.value,
                            }))
                          }
                          className="pos-input mt-1 w-full"
                          placeholder="0"
                        />
                        <p className="mt-1 text-xs text-gray-500">Leave at 0 for no percentage discount.</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="discountFlat">
                          Discount amount ($)
                        </label>
                        <input
                          id="discountFlat"
                          type="number"
                          min={0}
                          step={0.01}
                          value={form.globalDiscountFlat}
                          onChange={(event) =>
                            setForm((previous) => ({
                              ...previous,
                              globalDiscountFlat: event.target.value,
                            }))
                          }
                          className="pos-input mt-1 w-full"
                          placeholder="0.00"
                        />
                        <p className="mt-1 text-xs text-gray-500">Leave at 0.00 for no flat discount.</p>
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="flex items-center justify-between text-lg font-semibold text-gray-900">
                      <span>Admin Access Code</span>
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                          adminCodeSet
                            ? 'bg-camp-100 text-camp-700'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {adminCodeSet ? 'Enabled' : 'Disabled'}
                      </span>
                    </legend>
                    <p className="text-sm text-gray-600">
                      Require an admin code before updating these settings. Set a new code or clear the existing one.
                    </p>
                    {adminCodeSet ? (
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="currentAdminCode">
                          Current admin code
                        </label>
                        <input
                          id="currentAdminCode"
                          type="password"
                          value={form.currentAdminCode}
                          onChange={(event) =>
                            setForm((previous) => ({
                              ...previous,
                              currentAdminCode: event.target.value,
                            }))
                          }
                          className="pos-input mt-1 w-full md:max-w-sm"
                          placeholder="Enter current code"
                        />
                      </div>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-gray-700" htmlFor="newAdminCode">
                          {adminCodeSet ? 'New admin code' : 'Set admin code'}
                        </label>
                        <input
                          id="newAdminCode"
                          type="password"
                          value={form.newAdminCode}
                          onChange={(event) =>
                            setForm((previous) => ({
                              ...previous,
                              newAdminCode: event.target.value,
                              clearAdminCode: false,
                            }))
                          }
                          className="pos-input mt-1 w-full md:max-w-sm"
                          placeholder={adminCodeSet ? 'Leave blank to keep current' : 'At least 4 characters'}
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:border-red-500"
                          onClick={handleClearAdminCode}
                        >
                          Clear admin code
                        </button>
                      </div>
                    </div>
                    {form.clearAdminCode ? (
                      <p className="text-xs font-semibold text-red-600">
                        Admin code will be cleared after saving.
                      </p>
                    ) : null}
                  </fieldset>

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-camp-500"
                      disabled={saving}
                      onClick={() => void loadSettings()}
                    >
                      Reset
                    </button>
                    <button type="submit" className="pos-button" disabled={saving}>
                      {saving ? 'Saving…' : 'Save Settings'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
