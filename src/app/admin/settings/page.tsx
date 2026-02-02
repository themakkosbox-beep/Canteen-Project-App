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
import type {
  AppSettingsPayload,
  TransactionStatsSummary,
  BackupStatus,
  BackupResult,
  AppFeatureFlags,
  ShiftDefinition,
} from '@/types/database';
import { getAdminCode, setAdminCode } from '@/lib/admin-session';

interface SettingsFormState {
  brandName: string;
  globalDiscountPercent: string;
  globalDiscountFlat: string;
  newAdminCode: string;
  currentAdminCode: string;
  clearAdminCode: boolean;
  featureFlags: AppFeatureFlags;
  shifts: ShiftDefinition[];
  activeShiftId: string;
  printerStations: string[];
}

const defaultFormState: SettingsFormState = {
  brandName: '',
  globalDiscountPercent: '',
  globalDiscountFlat: '',
  newAdminCode: '',
  currentAdminCode: '',
  clearAdminCode: false,
  featureFlags: {
    offlineStatus: true,
    dailyCloseout: true,
    inventoryAlerts: true,
    refundFlow: true,
    activityLog: true,
    backupReminders: true,
    customerQr: true,
  },
  shifts: [
    { id: 'breakfast', label: 'Breakfast', startTime: '07:00', endTime: '10:30' },
    { id: 'lunch', label: 'Lunch', startTime: '11:00', endTime: '14:00' },
    { id: 'dinner', label: 'Dinner', startTime: '17:00', endTime: '20:00' },
  ],
  activeShiftId: 'breakfast',
  printerStations: ['Kitchen', 'Snack Bar', 'Grill'],
};

const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

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

const FEATURE_TOGGLES: Array<{
  key: keyof AppFeatureFlags;
  label: string;
  description: string;
}> = [
  {
    key: 'offlineStatus',
    label: 'Offline status badge',
    description: 'Show a banner so staff know the register is safe to use offline.',
  },
  {
    key: 'dailyCloseout',
    label: 'Daily closeout summary',
    description: 'Surface end-of-day totals for deposits, purchases, and adjustments.',
  },
  {
    key: 'inventoryAlerts',
    label: 'Inventory alerts',
    description: 'Highlight low-stock items for managers to restock.',
  },
  {
    key: 'refundFlow',
    label: 'Refunds & voids',
    description: 'Allow voids and refunds to be recorded with notes.',
  },
  {
    key: 'activityLog',
    label: 'Activity log',
    description: 'Track important admin actions like edits, backups, and exports.',
  },
  {
    key: 'backupReminders',
    label: 'Backup reminders',
    description: 'Show reminders when a backup has not been created recently.',
  },
  {
    key: 'customerQr',
    label: 'Customer QR cards',
    description: 'Generate QR codes for fast customer lookup at the register.',
  },
];

const SettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adminCodeSet, setAdminCodeSet] = useState(false);
  const [form, setForm] = useState<SettingsFormState>(defaultFormState);
  const [adminSessionCode, setAdminSessionCode] = useState<string | null>(() => getAdminCode());
  const [requiresAdminCode, setRequiresAdminCode] = useState(false);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [transactionStats, setTransactionStats] = useState<TransactionStatsSummary | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [loadingBackupStatus, setLoadingBackupStatus] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [newPrinterStation, setNewPrinterStation] = useState('');

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    []
  );

  const formatBackupTimestamp = (value: string | null) => {
    if (!value) {
      return 'Not available';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  };

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

  const loadBackupStatus = useCallback(
    async (overrideCode?: string | null) => {
      const candidate = (overrideCode ?? adminSessionCode ?? '').trim();
      if (requiresAdminCode && !candidate) {
        setBackupStatus(null);
        setBackupError('Enter the admin code to view backup status.');
        return;
      }

      setLoadingBackupStatus(true);
      setBackupError(null);

      try {
        const response = await fetch('/api/backups', {
          headers: candidate ? { 'x-admin-code': candidate } : undefined,
        });

        if (response.status === 401) {
          setBackupStatus(null);
          setBackupError('Admin code required to view backups.');
          setRequiresAdminCode(true);
          setAdminSessionCode(null);
          setAdminCode(null);
          setUnlockError('Admin code expired. Please enter it again to continue.');
          return;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? 'Failed to load backup status');
        }

        const data: BackupStatus = await response.json();
        setBackupStatus(data);
      } catch (err) {
        console.error(err);
        setBackupError(err instanceof Error ? err.message : 'Failed to load backup status');
      } finally {
        setLoadingBackupStatus(false);
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
            setAdminCode(null);
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
          featureFlags: data.featureFlags,
          shifts: Array.isArray(data.shifts) && data.shifts.length > 0 ? data.shifts : defaultFormState.shifts,
          activeShiftId: data.activeShiftId ?? defaultFormState.activeShiftId,
          printerStations:
            Array.isArray(data.printerStations) && data.printerStations.length > 0
              ? data.printerStations
              : defaultFormState.printerStations,
        });

        setRequiresAdminCode(false);
        setAdminSessionCode(resolvedCode ? resolvedCode : null);
        setAdminCode(resolvedCode || null);
        setUnlockCode('');
        setUnlockError(null);
        void loadTransactionStats(resolvedCode || null);
        void loadBackupStatus(resolvedCode || null);
        return true;
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [adminSessionCode, loadTransactionStats, loadBackupStatus]
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

  useEffect(() => {
    if (!adminSessionCode) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const lockAdmin = () => {
      setAdminSessionCode(null);
      setAdminCode(null);
      setRequiresAdminCode(true);
      setUnlockError('Admin session timed out. Please enter it again to continue.');
    };

    const resetTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(lockAdmin, ADMIN_IDLE_TIMEOUT_MS);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        lockAdmin();
      }
    };

    resetTimer();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [adminSessionCode, setRequiresAdminCode, setUnlockError]);

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

  const handleCopyPath = async () => {
    if (!backupStatus?.dataDirectory) {
      return;
    }

    try {
      await navigator.clipboard.writeText(backupStatus.dataDirectory);
      setBackupNotice('Data directory copied to clipboard.');
    } catch (error) {
      console.error(error);
      setBackupError('Unable to copy the data directory path.');
    }
  };

  const handleCreateBackup = async () => {
    const candidate = (adminSessionCode ?? '').trim();
    if (requiresAdminCode && !candidate) {
      setBackupError('Enter the admin code to create a backup.');
      return;
    }

    setCreatingBackup(true);
    setBackupError(null);
    setBackupNotice(null);

    try {
      const response = await fetch('/api/backups', {
        method: 'POST',
        headers: candidate ? { 'x-admin-code': candidate } : undefined,
      });

      if (response.status === 401) {
        setRequiresAdminCode(true);
        setAdminSessionCode(null);
        setAdminCode(null);
        setUnlockError('Admin code expired. Please enter it again to continue.');
        setBackupError('Admin code required to create a backup.');
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Failed to create backup');
      }

      const result = (await response.json()) as BackupResult;
      setBackupNotice(`Backup created: ${result.fileName}`);
      await loadBackupStatus(candidate);
    } catch (error) {
      console.error(error);
      setBackupError(error instanceof Error ? error.message : 'Failed to create backup');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async () => {
    const candidate = (adminSessionCode ?? '').trim();
    if (requiresAdminCode && !candidate) {
      setBackupError('Enter the admin code to restore a backup.');
      return;
    }

    if (!restoreFile) {
      setBackupError('Choose a backup file to restore.');
      return;
    }

    const confirmed = window.confirm(
      'Restoring a backup will replace the current database. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setRestoringBackup(true);
    setBackupError(null);
    setBackupNotice(null);

    try {
      const formData = new FormData();
      formData.append('file', restoreFile);

      const headers: Record<string, string> = {};
      if (candidate) {
        headers['x-admin-code'] = candidate;
      }

      const response = await fetch('/api/backups/restore', {
        method: 'POST',
        headers,
        body: formData,
      });

      if (response.status === 401) {
        setRequiresAdminCode(true);
        setAdminSessionCode(null);
        setAdminCode(null);
        setUnlockError('Admin code expired. Please enter it again to continue.');
        setBackupError('Admin code required to restore backups.');
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Failed to restore backup');
      }

      setBackupNotice('Backup restored successfully.');
      setRestoreFile(null);
      await loadSettings(candidate || null);
    } catch (error) {
      console.error(error);
      setBackupError(error instanceof Error ? error.message : 'Failed to restore backup');
    } finally {
      setRestoringBackup(false);
    }
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
      featureFlags: form.featureFlags,
      shifts: form.shifts,
      activeShiftId: form.activeShiftId,
      printerStations: form.printerStations,
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
        featureFlags: data.featureFlags,
        shifts: Array.isArray(data.shifts) && data.shifts.length > 0 ? data.shifts : defaultFormState.shifts,
        activeShiftId: data.activeShiftId ?? defaultFormState.activeShiftId,
        printerStations:
          Array.isArray(data.printerStations) && data.printerStations.length > 0
            ? data.printerStations
            : defaultFormState.printerStations,
      });
      setAdminSessionCode(resolvedCode ?? null);
      setAdminCode(resolvedCode ?? null);
      setRequiresAdminCode(Boolean(data.adminCodeSet && !resolvedCode));
      void loadTransactionStats(resolvedCode ?? null);
      void loadBackupStatus(resolvedCode ?? null);
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

  const handleFeatureToggle = (key: keyof AppFeatureFlags) => {
    setForm((previous) => ({
      ...previous,
      featureFlags: {
        ...previous.featureFlags,
        [key]: !previous.featureFlags[key],
      },
    }));
  };

  const handleShiftChange = (
    index: number,
    key: keyof ShiftDefinition,
    value: string
  ) => {
    setForm((previous) => {
      const updated = [...previous.shifts];
      const target = updated[index];
      if (!target) {
        return previous;
      }
      updated[index] = {
        ...target,
        [key]: value,
      };
      return { ...previous, shifts: updated };
    });
  };

  const handleAddShift = () => {
    setForm((previous) => ({
      ...previous,
      shifts: [
        ...previous.shifts,
        {
          id: `shift-${Date.now()}`,
          label: 'New Shift',
          startTime: '09:00',
          endTime: '12:00',
        },
      ],
    }));
  };

  const handleRemoveShift = (index: number) => {
    setForm((previous) => {
      const updated = previous.shifts.filter((_, idx) => idx !== index);
      const nextShifts = updated.length > 0 ? updated : previous.shifts;
      const nextActive =
        nextShifts.find((shift) => shift.id === previous.activeShiftId)?.id ??
        nextShifts[0]?.id ??
        '';
      return {
        ...previous,
        shifts: nextShifts,
        activeShiftId: nextActive,
      };
    });
  };

  const handleAddPrinterStation = () => {
    const trimmed = newPrinterStation.trim();
    if (!trimmed) {
      return;
    }
    setForm((previous) => ({
      ...previous,
      printerStations: Array.from(new Set([...previous.printerStations, trimmed])),
    }));
    setNewPrinterStation('');
  };

  const handleRemovePrinterStation = (station: string) => {
    setForm((previous) => ({
      ...previous,
      printerStations: previous.printerStations.filter((entry) => entry !== station),
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
    <div className="min-h-screen py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4">
        <header className="pb-6 border-b border-slate-200">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600">Settings</p>
          <h1 className="page-title mt-3">Manager controls</h1>
          <p className="mt-2 text-sm text-slate-500">
            Tune pricing rules, backups, and which tools appear on the register.
          </p>
        </header>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {success}
          </div>
        ) : null}

        {requiresAdminCode && !adminSessionCode ? (
          <section className="space-y-6 border border-slate-200 rounded-xl bg-white/80 p-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <LockClosedIcon className="h-8 w-8 text-gray-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">Admin Access Required</h2>
              <p className="mx-auto max-w-md text-gray-600">
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
            <section className="order-2 space-y-6 border-b border-slate-200 pb-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                    <BanknotesIcon className="h-6 w-6 text-gray-500" />
                    Transaction Snapshot
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Daily totals and balance movement across the register.
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
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-5">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
                          <CreditCardIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium uppercase tracking-wide text-emerald-900">Total Transactions</p>
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

            <section className="order-3 space-y-4 border-b border-slate-200 pb-8">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Data protection</h2>
                  <p className="text-sm text-gray-600">
                    Review backup health and restore when needed.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-emerald-400 disabled:opacity-60"
                  onClick={handleCreateBackup}
                  disabled={creatingBackup}
                >
                  {creatingBackup ? 'Creating...' : 'Create Backup'}
                </button>
              </div>

              {backupError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {backupError}
                </div>
              ) : null}

              {backupNotice ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {backupNotice}
                </div>
              ) : null}

              {loadingBackupStatus ? (
                <p className="text-sm text-gray-500">Loading backup status...</p>
              ) : backupStatus ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">Data directory</p>
                        <p className="mt-1 break-all text-sm font-medium text-gray-800">
                          {backupStatus.dataDirectory}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:border-emerald-400"
                        onClick={handleCopyPath}
                      >
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">Database: {backupStatus.dbPath}</p>
                    <p className="text-xs text-gray-500">Backups: {backupStatus.backupDirectory}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Latest backup</p>
                    <p className="text-sm font-medium text-gray-800">
                      {backupStatus.lastBackupFile ?? 'Not available'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatBackupTimestamp(backupStatus.lastBackupAt)}
                    </p>
                    <p className="text-xs text-gray-500">
                      Last restore: {formatBackupTimestamp(backupStatus.lastRestoreAt)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                  Backup status unavailable. Try refreshing or verify admin access.
                </div>
              )}

              <div className="rounded-lg border border-dashed border-gray-200 p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Restore from backup</h3>
                  <p className="text-xs text-gray-500">
                    Restoring replaces the active database. A safety backup is kept automatically.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    type="file"
                    accept=".db"
                    className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gray-700 hover:file:border-emerald-400"
                    disabled={restoringBackup}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setRestoreFile(file);
                      setBackupError(null);
                      setBackupNotice(null);
                    }}
                  />
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                    onClick={handleRestoreBackup}
                    disabled={!restoreFile || restoringBackup}
                  >
                    {restoringBackup ? 'Restoring...' : 'Restore Backup'}
                  </button>
                </div>
              </div>
            </section>

            <section className="order-1 border-b border-slate-200 pb-8">
              {loading ? (
                <p className="text-sm text-gray-500">Loading settings...</p>
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
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-emerald-400"
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
                    <legend className="text-lg font-semibold text-gray-900">Shift setup</legend>
                    <p className="text-sm text-gray-600">
                      Define your service windows. Shifts control product availability, quick keys, and printing queues.
                    </p>
                    <div className="space-y-3">
                      {form.shifts.map((shift, index) => (
                        <div key={shift.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">Shift {index + 1}</p>
                              <p className="text-xs text-gray-500">Used for POS filters and printing.</p>
                            </div>
                            <button
                              type="button"
                              className="text-xs font-semibold text-red-600 hover:underline"
                              onClick={() => handleRemoveShift(index)}
                              disabled={form.shifts.length <= 1}
                            >
                              Remove
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-4">
                            <div>
                              <label className="text-xs font-semibold text-gray-500">ID</label>
                              <input
                                value={shift.id}
                                onChange={(event) => handleShiftChange(index, 'id', event.target.value)}
                                className="pos-input mt-1 w-full"
                                placeholder="lunch"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-gray-500">Label</label>
                              <input
                                value={shift.label}
                                onChange={(event) => handleShiftChange(index, 'label', event.target.value)}
                                className="pos-input mt-1 w-full"
                                placeholder="Lunch"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-gray-500">Start</label>
                              <input
                                type="time"
                                value={shift.startTime}
                                onChange={(event) => handleShiftChange(index, 'startTime', event.target.value)}
                                className="pos-input mt-1 w-full"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-gray-500">End</label>
                              <input
                                type="time"
                                value={shift.endTime}
                                onChange={(event) => handleShiftChange(index, 'endTime', event.target.value)}
                                className="pos-input mt-1 w-full"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-emerald-400"
                        onClick={handleAddShift}
                      >
                        Add shift
                      </button>
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-700" htmlFor="activeShift">
                          Default active shift
                        </label>
                        <select
                          id="activeShift"
                          value={form.activeShiftId}
                          onChange={(event) =>
                            setForm((previous) => ({ ...previous, activeShiftId: event.target.value }))
                          }
                          className="pos-input"
                        >
                          {form.shifts.map((shift) => (
                            <option key={shift.id} value={shift.id}>
                              {shift.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="text-lg font-semibold text-gray-900">Printer stations</legend>
                    <p className="text-sm text-gray-600">
                      Define station names for kitchen or service printers.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {form.printerStations.map((station) => (
                        <span key={station} className="pill">
                          {station}
                          <button
                            type="button"
                            className="ml-1 text-xs font-semibold text-red-600"
                            onClick={() => handleRemovePrinterStation(station)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={newPrinterStation}
                        onChange={(event) => setNewPrinterStation(event.target.value)}
                        className="pos-input w-full max-w-xs"
                        placeholder="Add station (e.g., Kitchen)"
                      />
                      <button
                        type="button"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-emerald-400"
                        onClick={handleAddPrinterStation}
                      >
                        Add station
                      </button>
                    </div>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="text-lg font-semibold text-gray-900">Feature Toggles</legend>
                    <p className="text-sm text-gray-600">
                      Enable or disable offline-friendly capabilities and manager tools.
                    </p>
                    <div className="space-y-3">
                      {FEATURE_TOGGLES.map((toggle) => (
                        <label
                          key={toggle.key}
                          className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{toggle.label}</p>
                            <p className="text-xs text-gray-600">{toggle.description}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={form.featureFlags[toggle.key]}
                            onChange={() => handleFeatureToggle(toggle.key)}
                            className="mt-1 h-5 w-5 accent-emerald-600"
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="flex items-center justify-between text-lg font-semibold text-gray-900">
                      <span>Admin Access Code</span>
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                          adminCodeSet
                            ? 'bg-emerald-100 text-emerald-700'
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
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-emerald-400"
                      disabled={saving}
                      onClick={() => void loadSettings()}
                    >
                      Reset
                    </button>
                    <button type="submit" className="pos-button" disabled={saving}>
                      {saving ? 'Saving...' : 'Save Settings'}
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
