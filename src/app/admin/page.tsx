'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Customer, Product, QuickKeySlot, TransactionExportRow } from '@/types/database';

interface CustomerFormState {
  customerId: string;
  name: string;
  initialBalance: string;
}

interface ProductFormState {
  productId: string;
  name: string;
  price: string;
  barcode: string;
  category: string;
  active: boolean;
  options: ProductOptionGroupState[];
}

interface ProductOptionChoiceState {
  id: string;
  label: string;
}

interface ProductOptionGroupState {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: ProductOptionChoiceState[];
}

const QUICK_KEY_COUNT = 5;

const createEmptyQuickKeySlots = (): QuickKeySlot[] =>
  Array.from({ length: QUICK_KEY_COUNT }, (_, index) => ({
    index,
    productId: null,
    product: null,
  }));

const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

export default function AdminPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [bulkCustomerInput, setBulkCustomerInput] = useState('');
  const [bulkProductInput, setBulkProductInput] = useState('');
  const [bulkCustomerLoading, setBulkCustomerLoading] = useState(false);
  const [bulkProductLoading, setBulkProductLoading] = useState(false);

  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [includeInactiveProducts, setIncludeInactiveProducts] = useState(true);
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('all');
  const [productCategories, setProductCategories] = useState<string[]>([]);
  const [quickKeySlots, setQuickKeySlots] = useState<QuickKeySlot[]>(() => createEmptyQuickKeySlots());
  const [loadingQuickKeys, setLoadingQuickKeys] = useState(true);
  const [savingQuickKeys, setSavingQuickKeys] = useState(false);
  const [exportingTransactions, setExportingTransactions] = useState(false);

  const [customerForm, setCustomerForm] = useState<CustomerFormState>({
    customerId: '',
    name: '',
    initialBalance: '',
  });

  const [productForm, setProductForm] = useState<ProductFormState>({
    productId: '',
    name: '',
    price: '',
    barcode: '',
    category: '',
    active: true,
    options: [],
  });

  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  useEffect(() => {
    if (success) {
      const timeout = setTimeout(() => setSuccess(null), 4000);
      return () => clearTimeout(timeout);
    }
    return;
  }, [success]);

  useEffect(() => {
    setQuickKeySlots((previous) =>
      previous.map((slot) => {
        if (!slot.productId) {
          return slot;
        }

        const updated = products.find((product) => product.product_id === slot.productId);
        if (!updated) {
          return slot;
        }

        if (slot.product && slot.product.updated_at === updated.updated_at && slot.product.price === updated.price) {
          return slot;
        }

        return {
          ...slot,
          product: updated,
        };
      })
    );
  }, [products]);

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (customerSearch.trim().length > 0) {
        params.set('search', customerSearch.trim());
      }
      const response = await fetch(`/api/customers?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Unable to load customers');
      }
      const data: Customer[] = await response.json();
      setCustomers(data);
    } catch (err) {
      console.error(err);
  setError('Failed to load customers');
    } finally {
      setLoadingCustomers(false);
    }
  }, [customerSearch]);

  const handleQuickKeyChange = (index: number, nextProductId: string) => {
    setQuickKeySlots((previous) => {
      const normalized = typeof nextProductId === 'string' ? nextProductId.trim() : '';
      const lookup = new Map<string, Product>();
      products.forEach((product) => lookup.set(product.product_id, product));
      previous.forEach((slot) => {
        if (slot.product) {
          lookup.set(slot.product.product_id, slot.product);
        }
      });

      return previous.map((slot) => {
        if (slot.index !== index) {
          return slot;
        }

        if (normalized.length === 0) {
          return { index: slot.index, productId: null, product: null };
        }

        return {
          index: slot.index,
          productId: normalized,
          product: lookup.get(normalized) ?? null,
        };
      });
    });
  };

  const handleClearQuickKey = (index: number) => {
    setQuickKeySlots((previous) =>
      previous.map((slot) => (slot.index === index ? { index: slot.index, productId: null, product: null } : slot))
    );
  };

  const handleResetQuickKeys = () => {
    setQuickKeySlots(createEmptyQuickKeySlots());
  };

  const handleSaveQuickKeys = async () => {
    setSavingQuickKeys(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/quick-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: quickKeySlots.map((slot) => slot.productId) }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to save quick key settings');
      }

      const normalized = createEmptyQuickKeySlots();
      const slots: unknown = payload?.slots;
      if (Array.isArray(slots)) {
        slots.forEach((slot) => {
          if (!slot || typeof slot !== 'object') {
            return;
          }

          const index = Number((slot as { index?: unknown }).index);
          if (!Number.isInteger(index) || index < 0 || index >= QUICK_KEY_COUNT) {
            return;
          }

          const productId = (slot as { productId?: unknown }).productId;
          const product = (slot as { product?: unknown }).product as Product | null | undefined;

          normalized[index] = {
            index,
            productId:
              typeof productId === 'string' && productId.trim().length > 0
                ? productId.trim()
                : null,
            product: product ?? null,
          };
        });
      }

      setQuickKeySlots(normalized);
      setSuccess('Quick key buttons updated');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save quick key settings');
    } finally {
      setSavingQuickKeys(false);
    }
  };

  const exportTransactionsToCsv = async () => {
    setExportingTransactions(true);
    try {
      const response = await fetch('/api/transactions/export');
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'Failed to export transactions');
      }

      const data: unknown = await response.json();
      const rows: TransactionExportRow[] = Array.isArray(data) ? (data as TransactionExportRow[]) : [];

      const header = [
        'Date',
        'Time',
        'Customer ID',
        'Customer Name',
        'Type',
        'Product ID',
        'Product Name',
        'Product Price',
        'Amount',
        'Balance After',
        'Note',
      ];

      const csvLines: string[] = [header.map(escapeCsvValue).join(',')];

      rows.forEach((row) => {
        const timestamp = new Date(row.timestamp);
        const validDate = !Number.isNaN(timestamp.getTime());
        const datePart = validDate ? timestamp.toISOString().slice(0, 10) : '';
        const timePart = validDate
          ? timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '';

        const productPrice =
          typeof row.product_price === 'number' && Number.isFinite(row.product_price)
            ? row.product_price.toFixed(2)
            : '';

        const amount = Number.isFinite(row.amount) ? row.amount.toFixed(2) : '';
        const balanceAfter = Number.isFinite(row.balance_after) ? row.balance_after.toFixed(2) : '';

        csvLines.push(
          [
            datePart,
            timePart,
            row.customer_id,
            row.customer_name ?? '',
            row.type,
            row.product_id ?? '',
            row.product_name ?? '',
            productPrice,
            amount,
            balanceAfter,
            row.note ?? '',
          ]
            .map(escapeCsvValue)
            .join(',')
        );
      });

      const csvContent = csvLines.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.setAttribute('download', `transactions-${timestamp}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setSuccess('Transaction export ready for download');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to export transactions');
    } finally {
      setExportingTransactions(false);
    }
  };

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (includeInactiveProducts) {
        params.set('includeInactive', 'true');
      }
      if (productSearch.trim().length > 0) {
        params.set('search', productSearch.trim());
      }
      if (productCategoryFilter !== 'all') {
        params.set('category', productCategoryFilter);
      }

      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Unable to load products');
      }
      const data: Product[] = await response.json();
      setProducts(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load products');
    } finally {
      setLoadingProducts(false);
    }
  }, [includeInactiveProducts, productCategoryFilter, productSearch]);

  const loadQuickKeys = useCallback(async () => {
    setLoadingQuickKeys(true);
    try {
      const response = await fetch('/api/settings/quick-keys');
      if (!response.ok) {
        throw new Error('Unable to load quick key settings');
      }

      const data = await response.json();
      const normalized = createEmptyQuickKeySlots();
      const slots: unknown = data?.slots;

      if (Array.isArray(slots)) {
        slots.forEach((slot) => {
          if (!slot || typeof slot !== 'object') {
            return;
          }

          const index = Number((slot as { index?: unknown }).index);
          if (!Number.isInteger(index) || index < 0 || index >= QUICK_KEY_COUNT) {
            return;
          }

          const productId = (slot as { productId?: unknown }).productId;
          const product = (slot as { product?: unknown }).product as Product | null | undefined;

          normalized[index] = {
            index,
            productId:
              typeof productId === 'string' && productId.trim().length > 0
                ? productId.trim()
                : null,
            product: product ?? null,
          };
        });
      }

      setQuickKeySlots(normalized);
    } catch (err) {
      console.error(err);
      setQuickKeySlots(createEmptyQuickKeySlots());
      setError((previous) => previous ?? 'Failed to load quick key settings');
    } finally {
      setLoadingQuickKeys(false);
    }
  }, []);

  const loadProductCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/products/categories');
      if (!response.ok) {
        throw new Error('Unable to load product categories');
      }
      const data: string[] = await response.json();
      setProductCategories(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
    void loadProducts();
    void loadProductCategories();
    void loadQuickKeys();
  }, [loadCustomers, loadProducts, loadProductCategories, loadQuickKeys]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCustomers();
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch, loadCustomers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [includeInactiveProducts, loadProducts, productCategoryFilter, productSearch]);

  const handleCustomerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedId = customerForm.customerId.trim();

    if (!/^\d{4}$/.test(trimmedId)) {
      setError('Customer ID must be exactly 4 digits');
      return;
    }

    const trimmedName = customerForm.name.trim();
    if (editingCustomerId && trimmedName.length === 0) {
      setError('Customer name is required');
      return;
    }

    const parsedBalance = customerForm.initialBalance.trim().length
      ? Number.parseFloat(customerForm.initialBalance)
      : 0;

    if (!Number.isFinite(parsedBalance) || parsedBalance < 0) {
      setError('Initial balance must be zero or a positive number');
      return;
    }

    try {
      if (editingCustomerId) {
        const response = await fetch(`/api/customers/${editingCustomerId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmedName }),
        });

        if (!response.ok) {
          const message = await response.json();
          throw new Error(message.error ?? 'Failed to update customer');
        }

        setSuccess('Customer updated successfully');
      } else {
        const response = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: trimmedId,
            name: trimmedName,
            initialBalance: parsedBalance,
          }),
        });

        if (!response.ok) {
          const message = await response.json();
          throw new Error(message.error ?? 'Failed to create customer');
        }

        setSuccess('Customer created successfully');
      }

  setCustomerForm({ customerId: '', name: '', initialBalance: '' });
      setEditingCustomerId(null);
      await loadCustomers();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save customer');
    }
  };

  const handleProductSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedName = productForm.name.trim();
    if (trimmedName.length === 0) {
      setError('Product name is required');
      return;
    }

    const parsedPrice = Number.parseFloat(productForm.price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setError('Product price must be a positive number');
      return;
    }

    try {
      if (editingProductId) {
        const response = await fetch(`/api/products/${editingProductId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            price: parsedPrice,
            barcode: productForm.barcode.trim() || null,
            category: productForm.category.trim() || null,
            active: productForm.active,
            options: productForm.options,
          }),
        });

        if (!response.ok) {
          const message = await response.json();
          throw new Error(message.error ?? 'Failed to update product');
        }

        setSuccess('Product updated successfully');
      } else {
        const response = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: productForm.productId.trim() || undefined,
            name: trimmedName,
            price: parsedPrice,
            barcode: productForm.barcode.trim() || undefined,
            category: productForm.category.trim() || undefined,
            active: productForm.active,
            options: productForm.options,
          }),
        });

        if (!response.ok) {
          const message = await response.json();
          throw new Error(message.error ?? 'Failed to create product');
        }

        setSuccess('Product created successfully');
      }

      setProductForm({
        productId: '',
        name: '',
        price: '',
        barcode: '',
        category: '',
        active: true,
        options: [],
      });
      setEditingProductId(null);
      await loadProducts();
      await loadProductCategories();
      await loadQuickKeys();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  };

  const startEditCustomer = (customer: Customer) => {
    setCustomerForm({
      customerId: customer.customer_id,
      name: customer.name ?? '',
      initialBalance: '',
    });
    setEditingCustomerId(customer.customer_id);
  };

  const cancelCustomerEdit = () => {
    setEditingCustomerId(null);
    setCustomerForm({ customerId: '', name: '', initialBalance: '' });
  };

  const startEditProduct = (product: Product) => {
    setProductForm({
      productId: product.product_id,
      name: product.name,
      price: product.price.toString(),
      barcode: product.barcode ?? '',
      category: product.category ?? '',
      active: product.active,
      options:
        product.options?.map((group) => ({
          id: group.id,
          name: group.name,
          required: group.required,
          multiple: group.multiple,
          choices: group.choices.map((choice) => ({ id: choice.id, label: choice.label })),
        })) ?? [],
    });
    setEditingProductId(product.product_id);
  };

  const cancelProductEdit = () => {
    setEditingProductId(null);
    setProductForm({
      productId: '',
      name: '',
      price: '',
      barcode: '',
      category: '',
      active: true,
      options: [],
    });
  };

  const buildFailureSummary = (
    failures: Array<{ input: unknown; error: string }>,
    prefix: string
  ) => {
    if (failures.length === 0) {
      return null;
    }

    const preview = failures.slice(0, 3).map((failure, index) => {
      const serialized = JSON.stringify(failure.input);
      return `${index + 1}. ${failure.error} (${serialized})`;
    });

    const suffix = failures.length > 3 ? ` …and ${failures.length - 3} more.` : '';
    return `${prefix} ${preview.join(' ')}` + suffix;
  };

  const handleBulkCustomerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const lines = bulkCustomerInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const draftEntries: { customerId: string; name?: string; initialBalance?: number }[] = [];
    const localFailures: { input: unknown; error: string }[] = [];

    lines.forEach((line, index) => {
      const [rawId, rawName, rawBalance] = line.split(',');
      const customerId = rawId?.trim();
      if (!customerId || !/^\d{4}$/.test(customerId)) {
        localFailures.push({
          input: line,
          error: `Line ${index + 1}: customerId must be exactly 4 digits.`,
        });
        return;
      }

      const name = rawName?.trim()?.length ? rawName.trim() : undefined;
      let initialBalance: number | undefined;
      if (rawBalance && rawBalance.trim().length) {
        const parsed = Number.parseFloat(rawBalance.trim());
        if (!Number.isFinite(parsed) || parsed < 0) {
          localFailures.push({
            input: line,
            error: `Line ${index + 1}: initialBalance must be zero or a positive number.`,
          });
          return;
        }
        initialBalance = parsed;
      }

      draftEntries.push({ customerId, name, initialBalance });
    });

    if (draftEntries.length === 0) {
      setError('No valid customer rows to import.');
      return;
    }

    setBulkCustomerLoading(true);
    try {
      const response = await fetch('/api/customers/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customers: draftEntries }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? 'Bulk customer import failed.');
      }

      const message = `Imported ${result.createdCount ?? result.created?.length ?? 0} customers (${result.failedCount ?? result.failed?.length ?? 0} failed).`;
      setSuccess(message);

      const combinedFailures = [...(result.failed ?? []), ...localFailures];
      const failureSummary = buildFailureSummary(combinedFailures, 'Customer issues:');
      if (failureSummary) {
        setError(failureSummary);
      }

      setBulkCustomerInput('');
      await loadCustomers();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Bulk customer import failed.');
    } finally {
      setBulkCustomerLoading(false);
    }
  };

  const handleBulkProductSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const lines = bulkProductInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const draftEntries: {
      productId?: string;
      name: string;
      price: number;
      barcode?: string;
      category?: string;
      active?: boolean;
    }[] = [];
    const localFailures: { input: unknown; error: string }[] = [];

    lines.forEach((line, index) => {
      const parts = line.split(',');
      if (parts.length < 2) {
        localFailures.push({ input: line, error: `Line ${index + 1}: requires at least name and price.` });
        return;
      }

      const [rawName, rawPrice, rawProductId, rawBarcode, rawCategory, rawActive] = parts;
      const name = rawName?.trim();
      if (!name) {
        localFailures.push({ input: line, error: `Line ${index + 1}: name is required.` });
        return;
      }

      const parsedPrice = Number.parseFloat(rawPrice?.trim() ?? '');
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        localFailures.push({
          input: line,
          error: `Line ${index + 1}: price must be a positive number.`,
        });
        return;
      }

      const productId = rawProductId?.trim()?.length ? rawProductId.trim() : undefined;
      const barcode = rawBarcode?.trim()?.length ? rawBarcode.trim() : undefined;
      const category = rawCategory?.trim()?.length ? rawCategory.trim() : undefined;
      const active = rawActive?.trim()?.length
        ? ['true', '1', 'yes', 'active'].includes(rawActive.trim().toLowerCase())
        : undefined;

      draftEntries.push({ productId, name, price: parsedPrice, barcode, category, active });
    });

    if (draftEntries.length === 0) {
      setError('No valid product rows to import.');
      return;
    }

    setBulkProductLoading(true);
    try {
      const response = await fetch('/api/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: draftEntries }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? 'Bulk product import failed.');
      }

      const message = `Imported ${result.createdCount ?? result.created?.length ?? 0} products (${result.failedCount ?? result.failed?.length ?? 0} failed).`;
      setSuccess(message);

      const combinedFailures = [...(result.failed ?? []), ...localFailures];
      const failureSummary = buildFailureSummary(combinedFailures, 'Product issues:');
      if (failureSummary) {
        setError(failureSummary);
      }

      setBulkProductInput('');
      await loadProducts();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Bulk product import failed.');
    } finally {
      setBulkProductLoading(false);
    }
  };

    const currencyFormatter = useMemo(
      () => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
      []
    );

    const quickKeyOptions = useMemo(() => {
      const map = new Map<string, Product>();
      products.forEach((product) => map.set(product.product_id, product));
      quickKeySlots.forEach((slot) => {
        if (slot.product) {
          map.set(slot.product.product_id, slot.product);
        }
      });
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [products, quickKeySlots]);

  const customerCount = useMemo(() => customers.length, [customers]);
  const productCount = useMemo(() => products.length, [products]);

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-6xl mx-auto space-y-6 px-4">
        <header className="bg-white shadow rounded-lg p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-camp-700">Admin Panel</h1>
              <p className="text-gray-600 mt-1">
                Create and manage customers and products for the camp canteen.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-camp-50 border border-camp-500/20 rounded-lg p-4">
              <p className="text-sm uppercase text-camp-600 tracking-wide">Customers</p>
              <p className="text-2xl font-semibold">{customerCount}</p>
            </div>
            <div className="bg-camp-50 border border-camp-500/20 rounded-lg p-4">
              <p className="text-sm uppercase text-camp-600 tracking-wide">Products</p>
              <p className="text-2xl font-semibold">{productCount}</p>
            </div>
          </div>
        </header>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold">POS Quick Keys</h2>
              <p className="text-sm text-gray-600">
                Choose up to five products for the one-tap buttons shown on the POS terminal.
              </p>
            </div>
            {loadingQuickKeys ? (
              <p className="text-gray-500">Loading quick key settings…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quickKeySlots.map((slot) => (
                    <div key={slot.index}>
                      <label className="block text-sm font-medium text-gray-700">
                        Quick Key {slot.index + 1}
                      </label>
                      <div className="mt-1 flex gap-2">
                        <select
                          value={slot.productId ?? ''}
                          onChange={(event) => handleQuickKeyChange(slot.index, event.target.value)}
                          className="pos-input flex-1"
                        >
                          <option value="">— Unassigned —</option>
                          {quickKeyOptions.map((product) => (
                            <option key={product.product_id} value={product.product_id}>
                              {product.name} ({currencyFormatter.format(product.price)})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleClearQuickKey(slot.index)}
                          className="bg-gray-200 text-gray-700 font-semibold px-3 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveQuickKeys}
                    disabled={savingQuickKeys || loadingQuickKeys}
                    className="pos-button"
                  >
                    {savingQuickKeys ? 'Saving…' : 'Save Quick Keys'}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetQuickKeys}
                    className="bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg"
                    disabled={savingQuickKeys || loadingQuickKeys}
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Data Tools</h2>
              <p className="text-sm text-gray-600">
                Download a CSV containing every transaction with timestamps, customer details, and line items.
              </p>
            </div>
            <button
              type="button"
              onClick={exportTransactionsToCsv}
              disabled={exportingTransactions}
              className="pos-button w-full sm:w-auto"
            >
              {exportingTransactions ? 'Preparing…' : 'Export Transactions to CSV'}
            </button>
            <p className="text-xs text-gray-500">
              The export includes date, time, customer info, product details, and balance impact for each entry.
            </p>
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">
              {editingCustomerId ? 'Edit Customer' : 'Create Customer'}
            </h2>
            <p className="text-sm text-gray-600">
              {editingCustomerId
                ? 'Update customer details and save changes.'
                : 'Use the registration form to assign a 4-digit ID and optional starting balance.'}
            </p>
          </div>
          <form
            onSubmit={handleCustomerSubmit}
            className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700">Customer ID</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={customerForm.customerId}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
                  setCustomerForm((prev) => ({ ...prev, customerId: digits }));
                }}
                className="pos-input w-full mt-1"
                placeholder="1234"
                required
                disabled={Boolean(editingCustomerId)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={customerForm.name}
                onChange={(event) =>
                  setCustomerForm((prev) => ({ ...prev, name: event.target.value }))
                }
                className="pos-input w-full mt-1"
                placeholder="Camper name (optional)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Initial Balance</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={customerForm.initialBalance}
                onChange={(event) =>
                  setCustomerForm((prev) => ({ ...prev, initialBalance: event.target.value }))
                }
                className="pos-input w-full mt-1"
                placeholder="0.00"
                disabled={Boolean(editingCustomerId)}
              />
            </div>
            <div>
              <button
                type="submit"
                className="pos-button w-full"
                disabled={customerForm.customerId.length !== 4}
              >
                {editingCustomerId ? 'Update Customer' : 'Save Customer'}
              </button>
            </div>
            {editingCustomerId && (
              <div>
                <button
                  type="button"
                  onClick={cancelCustomerEdit}
                  className="w-full md:w-auto bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg"
                >
                  Cancel Edit
                </button>
              </div>
            )}
          </form>

          <div>
            <h3 className="text-lg font-semibold mb-3">Recent Customers</h3>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Search customers by name or ID"
                className="pos-input w-full sm:max-w-xs"
                type="search"
              />
              {customerSearch ? (
                <button
                  type="button"
                  onClick={() => setCustomerSearch('')}
                  className="self-start rounded-lg bg-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                >
                  Clear Search
                </button>
              ) : null}
            </div>
            {loadingCustomers ? (
              <p className="text-gray-500">Loading customers…</p>
            ) : customers.length === 0 ? (
              <p className="text-gray-500">No customers registered yet.</p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2">Customer ID</th>
                      <th className="text-left py-2 px-2">Name</th>
                      <th className="text-right py-2 px-2">Balance</th>
                      <th className="text-left py-2 px-2">Updated</th>
                      <th className="text-left py-2 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => (
                      <tr key={customer.customer_id} className="border-b border-gray-100">
                        <td className="py-2 px-2 font-semibold">#{customer.customer_id}</td>
                        <td className="py-2 px-2">{customer.name ?? '—'}</td>
                        <td className="py-2 px-2 text-right">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                          }).format(customer.balance)}
                        </td>
                        <td className="py-2 px-2 text-sm text-gray-500">
                          {new Date(customer.updated_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-2">
                          <button
                            type="button"
                            onClick={() => startEditCustomer(customer)}
                            className="text-camp-600 hover:underline text-sm font-semibold"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold mb-3">Bulk Import Customers</h3>
            <p className="text-sm text-gray-600 mb-3">
              Paste one customer per line using <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">1234, Name, InitialBalance</code>. Initial balance is optional.
            </p>
            <form onSubmit={handleBulkCustomerSubmit} className="space-y-3">
              <textarea
                value={bulkCustomerInput}
                onChange={(event) => setBulkCustomerInput(event.target.value)}
                className="pos-input w-full h-32 font-mono text-sm"
                placeholder={`1234, Jane Camper, 25.00\n5678, John Camper`}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="pos-button"
                  disabled={bulkCustomerLoading || bulkCustomerInput.trim().length === 0}
                >
                  {bulkCustomerLoading ? 'Importing…' : 'Import Customers'}
                </button>
                <button
                  type="button"
                  onClick={() => setBulkCustomerInput('')}
                  className="bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg"
                  disabled={bulkCustomerLoading}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">
              {editingProductId ? 'Edit Product' : 'Create Product'}
            </h2>
            <p className="text-sm text-gray-600">
              {editingProductId
                ? 'Update item details and availability status.'
                : 'Add items for sale with pricing, optional barcode, and category tags.'}
            </p>
          </div>
          <form
            onSubmit={handleProductSubmit}
            className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={productForm.name}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, name: event.target.value }))
                }
                className="pos-input w-full mt-1"
                placeholder="Snack Name"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={productForm.price}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, price: event.target.value }))
                }
                className="pos-input w-full mt-1"
                placeholder="1.50"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Barcode</label>
              <input
                type="text"
                value={productForm.barcode}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, barcode: event.target.value }))
                }
                className="pos-input w-full mt-1"
                placeholder="Scan or type (optional)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <input
                type="text"
                value={productForm.category}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, category: event.target.value }))
                }
                className="pos-input w-full mt-1"
                placeholder="Snacks, Drinks, etc."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Product ID</label>
              <input
                type="text"
                value={productForm.productId}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, productId: event.target.value }))
                }
                className="pos-input w-full mt-1"
                placeholder="Auto if blank"
                disabled={Boolean(editingProductId)}
              />
            </div>
            <div className="flex items-center space-x-2 md:col-span-5">
              <input
                id="product-active-checkbox"
                type="checkbox"
                checked={productForm.active}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, active: event.target.checked }))
                }
                className="h-5 w-5"
              />
              <label htmlFor="product-active-checkbox" className="text-sm font-medium text-gray-700">
                Active
              </label>
            </div>
            <div className="md:col-span-5">
              <button type="submit" className="pos-button w-full md:w-auto">
                {editingProductId ? 'Update Product' : 'Save Product'}
              </button>
            </div>
            {editingProductId && (
              <div className="md:col-span-5">
                <button
                  type="button"
                  onClick={cancelProductEdit}
                  className="bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg w-full md:w-auto"
                >
                  Cancel Edit
                </button>
              </div>
            )}
          </form>

          <div>
            <h3 className="text-lg font-semibold mb-3">Product Catalog</h3>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder="Search products"
                  className="pos-input w-full sm:max-w-xs"
                  type="search"
                />
                <select
                  value={productCategoryFilter}
                  onChange={(event) => setProductCategoryFilter(event.target.value)}
                  className="pos-input w-full sm:max-w-xs"
                >
                  <option value="all">All categories</option>
                  {productCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={includeInactiveProducts}
                    onChange={(event) => setIncludeInactiveProducts(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Show inactive products
                </label>
                {(productSearch || productCategoryFilter !== 'all' || !includeInactiveProducts) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProductSearch('');
                      setProductCategoryFilter('all');
                      setIncludeInactiveProducts(true);
                    }}
                    className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                  >
                    Reset Filters
                  </button>
                ) : null}
              </div>
            </div>
            {loadingProducts ? (
              <p className="text-gray-500">Loading products…</p>
            ) : products.length === 0 ? (
              <p className="text-gray-500">No products created yet.</p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2">Name</th>
                      <th className="text-right py-2 px-2">Price</th>
                      <th className="text-left py-2 px-2">Barcode</th>
                      <th className="text-left py-2 px-2">Category</th>
                      <th className="text-left py-2 px-2">Status</th>
                      <th className="text-left py-2 px-2">Updated</th>
                      <th className="text-left py-2 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr key={product.product_id} className="border-b border-gray-100">
                        <td className="py-2 px-2 font-medium">
                          {product.name}
                          <span className="block text-xs text-gray-500">{product.product_id}</span>
                        </td>
                        <td className="py-2 px-2 text-right">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                          }).format(product.price)}
                        </td>
                        <td className="py-2 px-2">{product.barcode ?? '—'}</td>
                        <td className="py-2 px-2">{product.category ?? '—'}</td>
                        <td className="py-2 px-2">
                          {product.active ? (
                            <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold uppercase">
                              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-gray-500 text-xs font-semibold uppercase">
                              <span className="h-2 w-2 rounded-full bg-gray-400" aria-hidden="true" />
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-sm text-gray-500">
                          {new Date(product.updated_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-2">
                          <button
                            type="button"
                            onClick={() => startEditProduct(product)}
                            className="text-camp-600 hover:underline text-sm font-semibold"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold mb-3">Bulk Import Products</h3>
            <p className="text-sm text-gray-600 mb-3">
              Format: <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">Name, Price, ProductID, Barcode, Category, Active</code>. Only name and price are required. Use <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">true</code> or <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">false</code> for the active flag.
            </p>
            <form onSubmit={handleBulkProductSubmit} className="space-y-3">
              <textarea
                value={bulkProductInput}
                onChange={(event) => setBulkProductInput(event.target.value)}
                className="pos-input w-full h-32 font-mono text-sm"
                placeholder={`Soda, 1.50, PRD_123, 0123456789, Drinks, true\nChips, 2.25`}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="pos-button"
                  disabled={bulkProductLoading || bulkProductInput.trim().length === 0}
                >
                  {bulkProductLoading ? 'Importing…' : 'Import Products'}
                </button>
                <button
                  type="button"
                  onClick={() => setBulkProductInput('')}
                  className="bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg"
                  disabled={bulkProductLoading}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
