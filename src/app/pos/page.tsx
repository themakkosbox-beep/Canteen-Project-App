'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Switch } from '@headlessui/react';
import {
  AcademicCapIcon,
  AdjustmentsHorizontalIcon,
  CheckCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Fuse from 'fuse.js';
import { Customer, Product, QuickKeySlot, TransactionLog } from '@/types/database';

interface POSState {
  currentCustomer: Customer | null;
  recentTransactions: TransactionLog[];
  isLoading: boolean;
  error: string | null;
}

interface TrainingCustomerState {
  customer: Customer;
  transactions: TransactionLog[];
  autoBalance: boolean;
}

interface BarcodeLearnModalState {
  open: boolean;
  barcode: string;
  name: string;
  price: string;
  category: string;
  error: string | null;
}

const QUICK_KEY_COUNT = 5;
const MAX_TRAINING_TRANSACTIONS = 25;

const TRAINING_CUSTOMER_PRESETS: Array<{ id: string; name: string; balance: number }> = [
  { id: '9100', name: 'Training Camper Alpha', balance: 25 },
  { id: '9200', name: 'Training Camper Bravo', balance: 30 },
  { id: '9300', name: 'Training Camper Charlie', balance: 18 },
  { id: '9400', name: 'Training Camper Delta', balance: 40 },
  { id: '9500', name: 'Training Camper Echo', balance: 12 },
];

const createTrainingCustomerEntry = (
  customerId: string,
  index: number,
  name?: string,
  balance?: number
): TrainingCustomerState => {
  const nowIso = new Date().toISOString();
  return {
    customer: {
      id: -(index + 1),
      customer_id: customerId,
      name,
      balance: balance ?? 30,
      created_at: nowIso,
      updated_at: nowIso,
    },
    transactions: [],
    autoBalance: false,
  };
};

const buildPresetTrainingCustomers = (): Record<string, TrainingCustomerState> =>
  TRAINING_CUSTOMER_PRESETS.reduce<Record<string, TrainingCustomerState>>((acc, preset, index) => {
    acc[preset.id] = createTrainingCustomerEntry(preset.id, index, preset.name, preset.balance);
    return acc;
  }, {});

const createEmptyQuickKeySlots = (): QuickKeySlot[] =>
  Array.from({ length: QUICK_KEY_COUNT }, (_, index) => ({
    index,
    productId: null,
    product: null,
  }));

const INITIAL_POS_STATE: POSState = {
  currentCustomer: null,
  recentTransactions: [],
  isLoading: false,
  error: null,
};

export default function POSPage() {
  const [state, setState] = useState<POSState>({ ...INITIAL_POS_STATE });
  const [customerIdInput, setCustomerIdInput] = useState('');
  const [entryInput, setEntryInput] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [quickKeySlots, setQuickKeySlots] = useState<QuickKeySlot[]>(createEmptyQuickKeySlots);
  const [loadingQuickKeys, setLoadingQuickKeys] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [note, setNote] = useState('');
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [trainingMode, setTrainingMode] = useState(false);
  const [trainingCustomers, setTrainingCustomers] = useState<Record<string, TrainingCustomerState>>(
    () => buildPresetTrainingCustomers()
  );
  const [activeTrainingCustomerId, setActiveTrainingCustomerId] = useState<string | null>(null);
  const [barcodeLearnMode, setBarcodeLearnMode] = useState(false);
  const [learnModalState, setLearnModalState] = useState<BarcodeLearnModalState>({
    open: false,
    barcode: '',
    name: '',
    price: '',
    category: '',
    error: null,
  });
  const [creatingLearnProduct, setCreatingLearnProduct] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);

  const entryInputRef = useRef<HTMLInputElement>(null);

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    []
  );

  const fuse = useMemo(() => {
    if (products.length === 0) {
      return null;
    }
    return new Fuse(products, {
      keys: ['name', 'barcode', 'product_id'],
      threshold: 0.35,
      ignoreLocation: true,
    });
  }, [products]);

  const productSuggestions = useMemo(() => {
    if (!products.length) {
      return [];
    }
    const trimmed = entryInput.trim();
    if (!trimmed) {
      return products.slice(0, 8);
    }
    if (!fuse) {
      return [];
    }
    return fuse.search(trimmed).map((result) => result.item).slice(0, 8);
  }, [entryInput, fuse, products]);

  const trainingCustomerList = useMemo(
    () =>
      Object.values(trainingCustomers).sort((a, b) =>
        a.customer.customer_id.localeCompare(b.customer.customer_id)
      ),
    [trainingCustomers]
  );

  useEffect(() => {
    void loadQuickKeys();
    void loadProducts();
    void loadCategories();
  }, []);

  useEffect(() => {
    setState({ ...INITIAL_POS_STATE });
    setCustomerIdInput('');
    setEntryInput('');
    setDepositAmount('');
    setAdjustmentAmount('');
    setNote('');
    setSelectedProduct(null);
    setShowAdjustmentForm(false);
    if (trainingMode) {
      setTrainingCustomers(buildPresetTrainingCustomers());
    }
    setActiveTrainingCustomerId(null);
  }, [trainingMode]);

  useEffect(() => {
    if (state.currentCustomer && entryInputRef.current) {
      entryInputRef.current.focus();
    }
  }, [state.currentCustomer]);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const loadQuickKeys = async () => {
    setLoadingQuickKeys(true);
    try {
      const response = await fetch('/api/settings/quick-keys');
      if (!response.ok) {
        throw new Error('Unable to load quick key settings');
      }
      const data = await response.json();
      const base = createEmptyQuickKeySlots();
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

          base[index] = {
            index,
            productId:
              typeof productId === 'string' && productId.trim().length > 0
                ? productId.trim()
                : null,
            product: product ?? null,
          };
        });
      }

      setQuickKeySlots(base);
    } catch (error) {
      console.error('Failed to load quick keys', error);
      setQuickKeySlots(createEmptyQuickKeySlots());
    } finally {
      setLoadingQuickKeys(false);
    }
  };

  const loadProducts = async () => {
    setProductsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '500', includeInactive: 'false' });
      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Unable to load products');
      }
      const data: Product[] = await response.json();
      setProducts(data.filter((product) => product.active));
    } catch (error) {
      console.error('Failed to load products', error);
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch('/api/products/categories');
      if (!response.ok) {
        throw new Error('Unable to load categories');
      }
      const data: string[] = await response.json();
      setCategories(data);
    } catch (error) {
      console.error('Failed to load categories', error);
      setCategories([]);
    }
  };

  const resolveProductById = (productId: string): Product | null => {
    return (
      products.find((product) => product.product_id === productId) ||
      quickKeySlots.find((slot) => slot.product?.product_id === productId)?.product ||
      null
    );
  };

  const resolveProductByBarcode = (barcode: string): Product | null => {
    return products.find((product) => product.barcode === barcode) ?? null;
  };

  const clearEntryInput = () => {
    setEntryInput('');
    setSelectedProduct(null);
    setShowProductDropdown(false);
    if (entryInputRef.current) {
      entryInputRef.current.focus();
    }
  };

  const loadCustomer = async (customerId: string) => {
    const trimmed = customerId.trim();
    if (trimmed.length !== 4) {
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    if (trainingMode) {
      let entry = trainingCustomers[trimmed];
      if (!entry) {
        entry = createTrainingCustomerEntry(
          trimmed,
          Object.keys(trainingCustomers).length,
          `Training ${trimmed}`
        );
        setTrainingCustomers((prev) => ({ ...prev, [trimmed]: entry! }));
      }

      setActiveTrainingCustomerId(trimmed);
      setState({
        currentCustomer: { ...entry.customer },
        recentTransactions: [...entry.transactions],
        isLoading: false,
        error: null,
      });
      return;
    }

    try {
      const response = await fetch(`/api/customers/${trimmed}`);
      if (!response.ok) {
        throw new Error('Customer not found');
      }

      const customer: Customer = await response.json();
      const transactionsResponse = await fetch(`/api/customers/${trimmed}/transactions`);
      const transactions: TransactionLog[] = await transactionsResponse.json();

      setState({
        currentCustomer: customer,
        recentTransactions: transactions,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load customer',
        isLoading: false,
      }));
    }
  };

  const updateTrainingEntry = (
    customerId: string,
    updater: (entry: TrainingCustomerState) => TrainingCustomerState
  ) => {
    setTrainingCustomers((prev) => {
      const current = prev[customerId];
      if (!current) {
        return prev;
      }
      const updated = updater(current);
      const next = { ...prev, [customerId]: updated };
      setState({
        currentCustomer: updated.customer,
        recentTransactions: updated.transactions,
        isLoading: false,
        error: null,
      });
      return next;
    });
  };

  const handlePurchase = async ({
    barcode,
    productId,
  }: {
    barcode?: string;
    productId?: string;
  }) => {
    if (!state.currentCustomer || (!barcode && !productId)) {
      return;
    }

    const customerId = state.currentCustomer.customer_id;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    if (trainingMode) {
      const entry = trainingCustomers[customerId];
      if (!entry) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Training customer not found' }));
        return;
      }

      const product = productId
        ? resolveProductById(productId)
        : barcode
        ? resolveProductByBarcode(barcode)
        : null;

      if (!product) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Product not found' }));
        return;
      }

      if (entry.customer.balance < product.price) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Insufficient balance' }));
        return;
      }

      const timestamp = new Date().toISOString();
      const transaction: TransactionLog = {
        id: Date.now(),
        transaction_id: `TRAIN_PURCHASE_${Date.now()}`,
        customer_id: customerId,
        type: 'purchase',
        product_id: product.product_id,
        amount: -product.price,
        balance_after: entry.customer.balance - product.price,
        note: undefined,
        timestamp,
        staff_id: undefined,
        product_name: product.name,
      };

      updateTrainingEntry(customerId, (current) => ({
        customer: { ...current.customer, balance: transaction.balance_after, updated_at: timestamp },
        transactions: [transaction, ...current.transactions].slice(0, MAX_TRAINING_TRANSACTIONS),
        autoBalance: current.autoBalance,
      }));
      clearEntryInput();
      return;
    }

    try {
      const response = await fetch('/api/transactions/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          barcode,
          productId,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.error === 'string' ? data.error : 'Purchase failed';

        if (barcode && barcodeLearnMode && message.toLowerCase().includes('product not found')) {
          setLearnModalState({
            open: true,
            barcode,
            name: '',
            price: '',
            category: '',
            error: null,
          });
          setState((prev) => ({ ...prev, isLoading: false }));
          return;
        }

        throw new Error(message);
      }

      await loadCustomer(customerId);
      clearEntryInput();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Purchase failed',
      }));
    }
  };

  const handleSelectedProductPurchase = () => {
    if (!selectedProduct || !state.currentCustomer || state.isLoading) {
      return;
    }
    void handlePurchase({ productId: selectedProduct.product_id });
    setShowProductDropdown(false);
  };

  const processDeposit = async () => {
    if (!state.currentCustomer || !depositAmount) {
      return;
    }

    const amount = Number.parseFloat(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setState((prev) => ({ ...prev, error: 'Invalid deposit amount' }));
      return;
    }

    const customerId = state.currentCustomer.customer_id;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    if (trainingMode) {
      const entry = trainingCustomers[customerId];
      if (!entry) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Training customer not found' }));
        return;
      }

      const timestamp = new Date().toISOString();
      const transaction: TransactionLog = {
        id: Date.now(),
        transaction_id: `TRAIN_DEPOSIT_${Date.now()}`,
        customer_id: customerId,
        type: 'deposit',
        amount,
        balance_after: entry.customer.balance + amount,
        note: note || undefined,
        timestamp,
        staff_id: undefined,
      };

      updateTrainingEntry(customerId, (current) => ({
        customer: { ...current.customer, balance: transaction.balance_after, updated_at: timestamp },
        transactions: [transaction, ...current.transactions].slice(0, MAX_TRAINING_TRANSACTIONS),
        autoBalance: current.autoBalance,
      }));
      setDepositAmount('');
      setNote('');
      return;
    }

    try {
      const response = await fetch('/api/transactions/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          amount,
          note: note || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Deposit failed');
      }

      await loadCustomer(customerId);
      setDepositAmount('');
      setNote('');
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Deposit failed',
      }));
    }
  };

  const processAdjustment = async () => {
    if (!state.currentCustomer || !adjustmentAmount) {
      return;
    }

    const amount = Number.parseFloat(adjustmentAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setState((prev) => ({ ...prev, error: 'Invalid adjustment amount' }));
      return;
    }

    const customerId = state.currentCustomer.customer_id;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    if (trainingMode) {
      const entry = trainingCustomers[customerId];
      if (!entry) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Training customer not found' }));
        return;
      }

      const timestamp = new Date().toISOString();
      const transaction: TransactionLog = {
        id: Date.now(),
        transaction_id: `TRAIN_ADJUST_${Date.now()}`,
        customer_id: customerId,
        type: 'adjustment',
        amount,
        balance_after: entry.customer.balance + amount,
        note: note || undefined,
        timestamp,
        staff_id: undefined,
      };

      updateTrainingEntry(customerId, (current) => ({
        customer: { ...current.customer, balance: transaction.balance_after, updated_at: timestamp },
        transactions: [transaction, ...current.transactions].slice(0, MAX_TRAINING_TRANSACTIONS),
        autoBalance: current.autoBalance,
      }));
      setAdjustmentAmount('');
      setNote('');
      setShowAdjustmentForm(false);
      return;
    }

    try {
      const response = await fetch('/api/transactions/adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          amount,
          note: note || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Adjustment failed');
      }

      await loadCustomer(customerId);
      setAdjustmentAmount('');
      setNote('');
      setShowAdjustmentForm(false);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Adjustment failed',
      }));
    }
  };

  const handleQuickKeyPurchase = (slot: QuickKeySlot) => {
    if (!slot.productId || !state.currentCustomer || state.isLoading) {
      return;
    }

    const product = slot.product ?? resolveProductById(slot.productId);
    if (!product) {
      setState((prev) => ({ ...prev, error: 'Quick key product is unavailable' }));
      return;
    }

    setSelectedProduct(product);
    void handlePurchase({ productId: slot.productId });
  };

  const handlePrimaryCharge = () => {
    if (!state.currentCustomer || state.isLoading) {
      return;
    }

    const trimmed = entryInput.trim();
    if (!trimmed) {
      return;
    }

    const barcodeMatch = resolveProductByBarcode(trimmed);
    if (barcodeMatch) {
      void handlePurchase({ barcode: trimmed });
      return;
    }

    const productMatch = resolveProductById(trimmed);
    if (productMatch) {
      setSelectedProduct(productMatch);
      void handlePurchase({ productId: productMatch.product_id });
      return;
    }

    if (selectedProduct) {
      void handleSelectedProductPurchase();
      return;
    }

    setSelectedProduct(null);
    setShowProductDropdown(true);
  };

  const handleDeleteTransaction = async (transaction: TransactionLog) => {
    if (!state.currentCustomer || trainingMode) {
      return;
    }

    const id = transaction.transaction_id;
    if (!id) {
      setState((prev) => ({ ...prev, error: 'This entry cannot be edited because it is missing an ID.' }));
      return;
    }

    setState((prev) => ({ ...prev, error: null }));
    setDeletingTransactionId(id);
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'Failed to delete transaction'
        );
      }

      await loadCustomer(state.currentCustomer.customer_id);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to delete transaction',
      }));
    } finally {
      setDeletingTransactionId(null);
    }
  };

  const closeLearnModal = () => {
    if (creatingLearnProduct) {
      return;
    }
    setLearnModalState({ open: false, barcode: '', name: '', price: '', category: '', error: null });
  };

  const handleLearnModalSubmit = async () => {
    if (!learnModalState.open) {
      return;
    }

    const trimmedName = learnModalState.name.trim();
    if (!trimmedName.length) {
      setLearnModalState((prev) => ({ ...prev, error: 'Product name is required' }));
      return;
    }

    const parsedPrice = Number.parseFloat(learnModalState.price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setLearnModalState((prev) => ({ ...prev, error: 'Price must be a positive number' }));
      return;
    }

    setCreatingLearnProduct(true);
    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          price: parsedPrice,
          barcode: learnModalState.barcode,
          category: learnModalState.category.trim() || undefined,
          active: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'Failed to create product from barcode'
        );
      }

      const product: Product = await response.json();
      setProducts((prev) => {
        const filtered = prev.filter((item) => item.product_id !== product.product_id);
        return [product, ...filtered];
      });
      await loadProducts();
      await loadQuickKeys();
      setLearnModalState({ open: false, barcode: '', name: '', price: '', category: '', error: null });
      setEntryInput(product.name);
      setSelectedProduct(product);
      setShowProductDropdown(false);

      if (state.currentCustomer) {
        await handlePurchase({ productId: product.product_id });
      }
    } catch (error) {
      setLearnModalState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to create product',
      }));
    } finally {
      setCreatingLearnProduct(false);
    }
  };

  const formatCurrency = (amount: number) => currencyFormatter.format(amount);

  const formatTime = (timestamp: string) =>
    new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

  const toggleClass = (enabled: boolean) =>
    `inline-flex items-center gap-2 rounded-full border px-4 py-1 text-sm font-semibold transition ${
      enabled
        ? 'border-camp-600 bg-camp-600 text-white shadow-sm'
        : 'border-gray-300 text-gray-600 hover:border-gray-400'
    }`;

  const canUseQuickKeys = Boolean(state.currentCustomer);
  const exportTransactionsToCsv = () => {
    if (!state.recentTransactions.length) {
      return;
    }

    const rows = [
      ['Transaction ID', 'Type', 'Amount', 'Balance After', 'Timestamp', 'Product', 'Note', 'Staff'],
      ...state.recentTransactions.map((transaction) => [
        transaction.transaction_id ?? '',
        transaction.type,
        formatCurrency(transaction.amount),
        formatCurrency(transaction.balance_after),
        new Date(transaction.timestamp).toLocaleString(),
        transaction.product_name ?? '',
        transaction.note ?? '',
        transaction.staff_id ?? '',
      ]),
    ];

    const csvContent = rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `transactions_${state.currentCustomer?.customer_id ?? 'export'}.csv`);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const filteredQuickKeys = quickKeySlots.filter((slot) => slot.productId);

  const renderQuickKey = (slot: QuickKeySlot) => {
    const product = slot.product ?? (slot.productId ? resolveProductById(slot.productId) : null);
    if (!product) {
      return (
        <button
          key={slot.index}
          className="h-24 rounded-xl border border-dashed border-gray-300 bg-white text-gray-400"
          type="button"
        >
          Empty
        </button>
      );
    }

    return (
      <button
        key={slot.index}
        className="flex h-24 flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 text-left shadow hover:border-camp-500 hover:shadow-md"
        onClick={() => handleQuickKeyPurchase(slot)}
        type="button"
      >
        <span className="font-semibold text-gray-800">{product.name}</span>
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{formatCurrency(product.price)}</span>
          {product.category ? <span className="rounded-full bg-camp-50 px-2 py-0.5 text-xs text-camp-600">{product.category}</span> : null}
        </div>
      </button>
    );
  };

  const renderQuickKeyGrid = () => {
    if (loadingQuickKeys) {
      return <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500">Loading quick keys...</div>;
    }

    if (!filteredQuickKeys.length) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500">
          No quick keys configured. Configure them in Settings {'>'} Quick Keys.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {quickKeySlots.map((slot) => renderQuickKey(slot))}
      </div>
    );
  };

  const filteredTransactions = state.recentTransactions.slice(0, 20);
  const canUseTrainingActions = trainingMode && Boolean(state.currentCustomer);
  const customerEmail =
    state.currentCustomer && typeof (state.currentCustomer as { email?: unknown }).email === 'string'
      ? ((state.currentCustomer as { email?: string }).email || null)
      : null;
  const activeTrainingAutoBalance = activeTrainingCustomerId
    ? Boolean(trainingCustomers[activeTrainingCustomerId]?.autoBalance)
    : false;
  const formattedCurrentTime = useMemo(
    () =>
      currentTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [currentTime]
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Point of Sale</h1>
            <p className="text-sm text-gray-500">Scan barcodes, use quick keys, or search products to charge customers.</p>
            <time
              aria-live="polite"
              className="mt-2 block text-sm font-semibold text-gray-600 sm:hidden"
              dateTime={currentTime.toISOString()}
            >
              {formattedCurrentTime}
            </time>
          </div>
          <div className="flex items-center gap-3">
            <time
              aria-live="polite"
              className="hidden text-sm font-semibold text-gray-600 sm:block"
              dateTime={currentTime.toISOString()}
            >
              {formattedCurrentTime}
            </time>
            <button
              className={toggleClass(trainingMode)}
              onClick={() => setTrainingMode((prev) => !prev)}
              type="button"
            >
              {trainingMode ? <CheckCircleIcon className="h-4 w-4" /> : <AcademicCapIcon className="h-4 w-4" />}
              Training Mode
            </button>
            <button
              className={toggleClass(barcodeLearnMode)}
              onClick={() => setBarcodeLearnMode((prev) => !prev)}
              type="button"
            >
              {barcodeLearnMode ? <CheckCircleIcon className="h-4 w-4" /> : <SparklesIcon className="h-4 w-4" />}
              Barcode Learn
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 flex-col gap-3">
                  <label className="text-sm font-medium text-gray-700" htmlFor="customerId">
                    Customer ID
                  </label>
                  <div className="flex gap-3">
                    <input
                      autoFocus
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-lg shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                      id="customerId"
                      maxLength={4}
                      minLength={4}
                      onChange={(event) => setCustomerIdInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void loadCustomer(customerIdInput);
                        }
                      }}
                      placeholder="Enter 4-digit ID"
                      value={customerIdInput}
                    />
                    <button
                      className="rounded-lg bg-camp-600 px-4 py-2 font-semibold text-white shadow hover:bg-camp-700"
                      onClick={() => loadCustomer(customerIdInput)}
                      type="button"
                    >
                      Lookup
                    </button>
                  </div>
                  {trainingMode ? (
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <Switch
                        checked={activeTrainingAutoBalance}
                        onChange={(enabled) => {
                          if (!activeTrainingCustomerId) {
                            return;
                          }
                          updateTrainingEntry(activeTrainingCustomerId, (entry) => ({
                            customer: { ...entry.customer },
                            transactions: [...entry.transactions],
                            autoBalance: enabled,
                          }));
                        }}
                        className={`${
                          activeTrainingAutoBalance ? 'bg-camp-600' : 'bg-gray-300'
                        } relative inline-flex h-6 w-11 items-center rounded-full transition`}
                      >
                        <span className="sr-only">Toggle auto-balance</span>
                        <span
                          className={`${
                            activeTrainingAutoBalance ? 'translate-x-6' : 'translate-x-1'
                          } inline-block h-4 w-4 transform rounded-full bg-white transition`}
                        />
                      </Switch>
                      <span>Auto-refill balance between scenarios</span>
                    </div>
                  ) : null}
                </div>

                <div className="flex w-full flex-1 flex-col gap-3">
                  <label className="text-sm font-medium text-gray-700" htmlFor="charge-input">
                    Scan Barcode or Search Products
                  </label>
                  <div className="relative">
                    <div className="flex gap-3">
                      <input
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 text-lg shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                        id="charge-input"
                        onBlur={() => setTimeout(() => setShowProductDropdown(false), 150)}
                        onChange={(event) => {
                          const value = event.target.value;
                          setEntryInput(value);
                          setShowProductDropdown(true);
                          if (!value.trim()) {
                            setSelectedProduct(null);
                          }
                        }}
                        onFocus={() => setShowProductDropdown(true)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handlePrimaryCharge();
                          }
                        }}
                        placeholder={
                          barcodeLearnMode
                            ? 'Scan to learn or begin typing to search'
                            : 'Scan barcode or search by name/ID'
                        }
                        ref={entryInputRef}
                        value={entryInput}
                      />
                      <button
                        className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-600 shadow hover:border-camp-500"
                        disabled={!state.currentCustomer || !entryInput.trim() || state.isLoading}
                        onClick={handlePrimaryCharge}
                        type="button"
                      >
                        Charge
                      </button>
                    </div>
                    {showProductDropdown && productSuggestions.length ? (
                      <div
                        className="absolute z-10 mt-2 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {productSuggestions.map((product) => (
                          <button
                            key={product.product_id}
                            className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-camp-50"
                            onClick={() => {
                              setSelectedProduct(product);
                              setEntryInput(product.name);
                              setShowProductDropdown(false);
                            }}
                            type="button"
                          >
                            <span className="font-medium text-gray-800">{product.name}</span>
                            <span className="text-gray-500">{formatCurrency(product.price)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-500">
                    Press Enter to charge a scanned barcode immediately, or pick from the suggestions below.
                  </p>
                  {barcodeLearnMode ? (
                    <p className="text-sm text-camp-600">
                      Unknown barcodes can be converted into products in one step.
                    </p>
                  ) : null}
                </div>
              </div>

              {productsLoading ? (
                <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500">
                  Loading products
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>Quick filters:</span>
                    {categories.length === 0 ? (
                      <span className="text-gray-400">No categories yet.</span>
                    ) : null}
                    {categories.map((category) => (
                      <button
                        key={category}
                        className="rounded-full border border-gray-200 px-3 py-1 hover:border-camp-500 hover:text-camp-600"
                        onClick={() => {
                          setEntryInput(category);
                          setShowProductDropdown(true);
                          setTimeout(() => entryInputRef.current?.focus(), 0);
                        }}
                        type="button"
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {selectedProduct ? selectedProduct.name : 'No product selected'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {selectedProduct
                          ? `Price: ${formatCurrency(selectedProduct.price)}`
                          : 'Use a suggestion, filter, or quick key to pick an item.'}
                      </p>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
                      <button
                        className="rounded-lg bg-camp-600 px-4 py-2 font-semibold text-white shadow hover:bg-camp-700"
                        disabled={!selectedProduct || !state.currentCustomer || state.isLoading}
                        onClick={handleSelectedProductPurchase}
                        type="button"
                      >
                        Charge Selected
                        {selectedProduct ? ` (${formatCurrency(selectedProduct.price)})` : ''}
                      </button>
                      <button
                        className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-600 shadow hover:border-camp-500"
                        disabled={state.isLoading}
                        onClick={clearEntryInput}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Quick Keys</h2>
                  <p className="text-sm text-gray-500">
                    Pre-configured products for rapid checkout.
                  </p>
                </div>
                <button
                  className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 shadow hover:border-camp-500"
                  onClick={() => {
                    setTrainingMode((prev) => prev);
                    void loadQuickKeys();
                  }}
                  type="button"
                >
                  Refresh
                </button>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                {canUseQuickKeys ? renderQuickKeyGrid() : (
                  <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500">
                    Lookup a customer to enable quick keys.
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Customer</h2>
                  <p className="text-sm text-gray-500">Details and balance overview.</p>
                </div>
                {state.currentCustomer ? (
                  <button
                    className="text-sm font-semibold text-camp-600 hover:text-camp-700"
                    onClick={() => {
                      setState({ ...INITIAL_POS_STATE });
                      setCustomerIdInput('');
                      clearEntryInput();
                    }}
                    type="button"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {state.isLoading ? (
                <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500">
                  Loading customer
                </div>
              ) : state.currentCustomer ? (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">{state.currentCustomer.name}</p>
                      <p className="text-xs text-gray-500">ID: {state.currentCustomer.customer_id}</p>
                    </div>
                    <span className="rounded-full bg-camp-50 px-3 py-1 text-sm font-semibold text-camp-600">
                      {formatCurrency(state.currentCustomer.balance)}
                    </span>
                  </div>
                  {customerEmail ? (
                    <p className="text-sm text-gray-500">{customerEmail}</p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-gray-500">Last updated</p>
                      <p className="font-semibold text-gray-800">
                        {new Date(state.currentCustomer.updated_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-gray-500">Created</p>
                      <p className="font-semibold text-gray-800">
                        {new Date(state.currentCustomer.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500">
                  Lookup a customer to begin.
                </div>
              )}

              {state.error ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow">
              <h2 className="text-base font-semibold text-gray-900">Balance Actions</h2>
              <p className="text-sm text-gray-500">Deposits, adjustments, and training scenarios.</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="deposit">
                    Deposit Amount
                  </label>
                  <div className="mt-2 flex gap-3">
                    <input
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-base shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                      disabled={!state.currentCustomer}
                      id="deposit"
                      onChange={(event) => setDepositAmount(event.target.value)}
                      placeholder="Enter amount"
                      type="number"
                      value={depositAmount}
                    />
                    <button
                      className="rounded-lg bg-camp-600 px-4 py-2 font-semibold text-white shadow hover:bg-camp-700"
                      disabled={!state.currentCustomer || state.isLoading}
                      onClick={() => void processDeposit()}
                      type="button"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                <div>
                  <button
                    className="flex items-center gap-2 text-sm font-semibold text-camp-600 hover:text-camp-700"
                    disabled={!state.currentCustomer}
                    onClick={() => setShowAdjustmentForm((prev) => !prev)}
                    type="button"
                  >
                    <AdjustmentsHorizontalIcon className="h-4 w-4" />
                    {showAdjustmentForm ? 'Hide Adjustment' : 'Manual Adjustment'}
                  </button>
                  {showAdjustmentForm ? (
                    <div className="mt-3">
                      <label className="text-sm font-medium text-gray-700" htmlFor="adjustment">
                        Adjustment Amount
                      </label>
                      <div className="mt-2 flex gap-3">
                        <input
                          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-base shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                          id="adjustment"
                          onChange={(event) => setAdjustmentAmount(event.target.value)}
                          placeholder="Positive or negative amount"
                          type="number"
                          value={adjustmentAmount}
                        />
                        <button
                          className="rounded-lg bg-camp-600 px-4 py-2 font-semibold text-white shadow hover:bg-camp-700"
                          disabled={!state.currentCustomer || state.isLoading}
                          onClick={() => void processAdjustment()}
                          type="button"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700" htmlFor="note">
                    Note (optional)
                  </label>
                  <textarea
                    className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                    id="note"
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Add context for this transaction"
                    rows={3}
                    value={note}
                  />
                </div>

                {canUseTrainingActions ? (
                  <div className="space-y-3 rounded-lg border border-camp-200 bg-camp-50 p-4 text-sm">
                    <p className="font-semibold text-camp-700">Training Scenarios</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded-full border border-camp-300 px-3 py-1 text-xs font-semibold text-camp-700 hover:border-camp-400"
                        onClick={() => {
                          if (!state.currentCustomer) {
                            return;
                          }
                          updateTrainingEntry(state.currentCustomer.customer_id, (entry) => ({
                            customer: { ...entry.customer, balance: 100, updated_at: new Date().toISOString() },
                            transactions: entry.transactions,
                            autoBalance: entry.autoBalance,
                          }));
                        }}
                        type="button"
                      >
                        Reset Balance to $100
                      </button>
                      <button
                        className="rounded-full border border-camp-300 px-3 py-1 text-xs font-semibold text-camp-700 hover:border-camp-400"
                        onClick={() => {
                          if (!state.currentCustomer) {
                            return;
                          }
                          updateTrainingEntry(state.currentCustomer.customer_id, (entry) => ({
                            customer: {
                              ...entry.customer,
                              balance: entry.autoBalance ? entry.customer.balance + 25 : 25,
                              updated_at: new Date().toISOString(),
                            },
                            transactions: entry.transactions,
                            autoBalance: entry.autoBalance,
                          }));
                        }}
                        type="button"
                      >
                        Add $25 Allowance
                      </button>
                      <button
                        className="rounded-full border border-camp-300 px-3 py-1 text-xs font-semibold text-camp-700 hover:border-camp-400"
                        onClick={() => {
                          if (!state.currentCustomer) {
                            return;
                          }
                          updateTrainingEntry(state.currentCustomer.customer_id, (entry) => ({
                            customer: { ...entry.customer, balance: 0, updated_at: new Date().toISOString() },
                            transactions: entry.transactions,
                            autoBalance: entry.autoBalance,
                          }));
                        }}
                        type="button"
                      >
                        Simulate Zero Balance
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Recent Activity</h2>
                  <p className="text-sm text-gray-500">Latest transactions for this customer.</p>
                </div>
                <button
                  className="text-sm font-semibold text-camp-600 hover:text-camp-700"
                  disabled={!state.recentTransactions.length}
                  onClick={exportTransactionsToCsv}
                  type="button"
                >
                  Export CSV
                </button>
              </div>
              {trainingMode ? (
                <p className="mt-2 text-xs text-gray-500">
                  Editing is disabled in training mode. Switch back to live mode to void transactions.
                </p>
              ) : null}

              {state.recentTransactions.length ? (
                <div className="mt-4 space-y-3">
                  {filteredTransactions.map((transaction) => {
                    const amountPositive = transaction.amount >= 0;
                    const canDelete = !trainingMode && Boolean(transaction.transaction_id);
                    const isDeleting =
                      canDelete && deletingTransactionId === transaction.transaction_id;

                    return (
                      <div
                        key={transaction.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-800">
                              {transaction.type === 'purchase'
                                ? transaction.product_name ?? 'Purchase'
                                : transaction.type === 'deposit'
                                ? 'Deposit'
                                : 'Adjustment'}
                            </p>
                            {transaction.note ? (
                              <p className="text-xs text-gray-500">{transaction.note}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-2 text-right sm:flex-row sm:items-center sm:gap-3">
                            <span
                              className={`text-sm font-semibold ${
                                amountPositive ? 'text-camp-600' : 'text-red-600'
                              }`}
                            >
                              {amountPositive
                                ? `+${formatCurrency(transaction.amount)}`
                                : `-${formatCurrency(Math.abs(transaction.amount))}`}
                            </span>
                            {canDelete ? (
                              <button
                                className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm hover:border-red-400 hover:text-red-600"
                                disabled={isDeleting || state.isLoading}
                                onClick={() => handleDeleteTransaction(transaction)}
                                type="button"
                              >
                                {isDeleting ? 'Removing…' : 'Void'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
                          <span>{new Date(transaction.timestamp).toLocaleDateString()}</span>
                          <span>{formatTime(transaction.timestamp)}</span>
                          <span>Balance: {formatCurrency(transaction.balance_after)}</span>
                          {transaction.staff_id ? <span>Staff: {transaction.staff_id}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500">
                  No transactions yet.
                </div>
              )}
            </section>

            {trainingMode ? (
              <section className="rounded-xl border border-gray-200 bg-white p-6 shadow">
                <h2 className="text-base font-semibold text-gray-900">Training Customers</h2>
                <p className="text-sm text-gray-500">
                  Quickly load preset customers with different balances.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-3">
                  {trainingCustomerList.map((entry) => (
                    <button
                      key={entry.customer.customer_id}
                      className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left shadow-sm transition ${
                        activeTrainingCustomerId === entry.customer.customer_id
                          ? 'border-camp-500 bg-camp-50'
                          : 'border-gray-200 bg-white hover:border-camp-400'
                      }`}
                      onClick={() => {
                        void loadCustomer(entry.customer.customer_id);
                      }}
                      type="button"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{entry.customer.name}</p>
                        <p className="text-xs text-gray-500">ID: {entry.customer.customer_id}</p>
                      </div>
                      <span className="rounded-full bg-camp-100 px-3 py-1 text-sm font-semibold text-camp-700">
                        {formatCurrency(entry.customer.balance)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </main>

      <Dialog open={learnModalState.open} onClose={closeLearnModal}>
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Create Product from Barcode
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-gray-500">
              We couldn&apos;t find a product with barcode {learnModalState.barcode}. Fill out the details to add it now.
            </Dialog.Description>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="learn-name">
                  Product Name
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                  id="learn-name"
                  onChange={(event) =>
                    setLearnModalState((prev) => ({ ...prev, name: event.target.value }))
                  }
                  value={learnModalState.name}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="learn-price">
                  Price
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                  id="learn-price"
                  onChange={(event) =>
                    setLearnModalState((prev) => ({ ...prev, price: event.target.value }))
                  }
                  type="number"
                  value={learnModalState.price}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700" htmlFor="learn-category">
                  Category
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                  id="learn-category"
                  onChange={(event) =>
                    setLearnModalState((prev) => ({ ...prev, category: event.target.value }))
                  }
                  placeholder="Optional"
                  value={learnModalState.category}
                />
              </div>

              {learnModalState.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {learnModalState.error}
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 shadow hover:border-camp-500"
                disabled={creatingLearnProduct}
                onClick={closeLearnModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-camp-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-camp-700"
                disabled={creatingLearnProduct}
                onClick={() => void handleLearnModalSubmit()}
                type="button"
              >
                Save Product & Charge
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}
