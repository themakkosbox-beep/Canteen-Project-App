'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import type { AppSettingsPayload } from '@/types/database';

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

const SettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adminCodeSet, setAdminCodeSet] = useState(false);
  const [form, setForm] = useState<SettingsFormState>(defaultFormState);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/app');
      if (!response.ok) {
        throw new Error('Unable to load settings');
      }
      const data: AppSettingsPayload = await response.json();
      setAdminCodeSet(data.adminCodeSet);
      setForm({
        brandName: data.brandName,
        globalDiscountPercent: formatNumberInput(data.globalDiscountPercent),
        globalDiscountFlat: formatNumberInput(data.globalDiscountFlat),
        newAdminCode: '',
        currentAdminCode: '',
        clearAdminCode: false,
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!success) {
      return;
    }
    const timeout = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timeout);
  }, [success]);

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
      const response = await fetch('/api/settings/app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await response.json().catch(() => ({}));
        throw new Error(message?.error ?? 'Failed to save settings');
      }

      const data: AppSettingsPayload = await response.json();
      setAdminCodeSet(data.adminCodeSet);
      setForm({
        brandName: data.brandName,
        globalDiscountPercent: formatNumberInput(data.globalDiscountPercent),
        globalDiscountFlat: formatNumberInput(data.globalDiscountFlat),
        newAdminCode: '',
        currentAdminCode: '',
        clearAdminCode: false,
      });
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
                <button
                  type="submit"
                  className="pos-button"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;
