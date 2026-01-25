'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Switch } from '@headlessui/react';
import {
  AcademicCapIcon,
  AdjustmentsHorizontalIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import Fuse from 'fuse.js';
import {
  Customer,
  AppSettingsPayload,
  Product,
  ProductOptionGroup,
  ProductOptionSelection,
  QuickKeySlot,
  TransactionLog,
  TransactionOptionSelection,
} from '@/types/database';
import { getAdminCode } from '@/lib/admin-session';

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

const QUICK_KEY_COUNT = 6;
const MAX_TRAINING_TRANSACTIONS = 25;

type PurchaseTrigger = {
  productId?: string;
  barcode?: string;
};

type OptionSelectionMap = Record<string, string[]>;

interface OptionModalState {
  open: boolean;
  product: Product | null;
  trigger: PurchaseTrigger | null;
  selections: OptionSelectionMap;
  error: string | null;
  submitting: boolean;
}

interface EditModalState {
  open: boolean;
  transaction: TransactionLog | null;
  product: Product | null;
  productId: string;
  selections: OptionSelectionMap;
  note: string;
  error: string | null;
  submitting: boolean;
}

interface BalanceEditModalState {
  open: boolean;
  transaction: TransactionLog | null;
  amount: string;
  note: string;
  error: string | null;
  submitting: boolean;
}

interface OptionEvaluationResult {
  productSelections: ProductOptionSelection[];
  transactionSelections: TransactionOptionSelection[];
  totalDelta: number;
  missingRequired: string[];
}

interface DiscountLine {
  label: string;
  amount: number;
}

interface PurchasePreview {
  evaluation: OptionEvaluationResult;
  basePrice: number;
  optionsDelta: number;
  subtotal: number;
  discounts: DiscountLine[];
  finalTotal: number;
}

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const formatPercentLabel = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const absolute = Math.abs(value);
  const rounded = Math.round(absolute * 100) / 100;
  const formatted = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return formatted;
};

const createEmptyOptionModalState = (): OptionModalState => ({
  open: false,
  product: null,
  trigger: null,
  selections: {},
  error: null,
  submitting: false,
});

const createInitialSelectionMap = (product: Product | null): OptionSelectionMap => {
  const map: OptionSelectionMap = {};
  if (!product || !Array.isArray(product.options)) {
    return map;
  }

  product.options.forEach((group) => {
    if (!group || typeof group.id !== 'string') {
      return;
    }

    if (group.required && !group.multiple && group.choices.length === 1) {
      const firstChoice = group.choices[0];
      if (firstChoice && typeof firstChoice.id === 'string') {
        map[group.id] = [firstChoice.id];
        return;
      }
    }

    map[group.id] = [];
  });

  return map;
};

const buildSelectionMapFromProductSelections = (
  product: Product,
  selections?: ProductOptionSelection[] | null
): OptionSelectionMap => {
  const map: OptionSelectionMap = {};
  if (!product || !Array.isArray(product.options)) {
    return map;
  }

  product.options.forEach((group) => {
    if (!group || typeof group.id !== 'string') {
      return;
    }
    map[group.id] = [];
  });

  if (!Array.isArray(selections)) {
    return map;
  }

  selections.forEach((selection) => {
    if (!selection || typeof selection.groupId !== 'string') {
      return;
    }
    if (!Array.isArray(selection.choiceIds)) {
      return;
    }

    if (!(selection.groupId in map)) {
      return;
    }

    map[selection.groupId] = selection.choiceIds.filter(
      (id) => typeof id === 'string' && id.trim().length > 0
    );
  });

  return map;
};

const transactionOptionsToProductSelections = (
  options?: TransactionOptionSelection[] | null
): ProductOptionSelection[] => {
  if (!Array.isArray(options) || options.length === 0) {
    return [];
  }

  return options.map((group) => ({
    groupId: group.groupId,
    choiceIds: group.choices.map((choice) => choice.id),
  }));
};

const createEmptyEditModalState = (): EditModalState => ({
  open: false,
  transaction: null,
  product: null,
  productId: '',
  selections: {},
  note: '',
  error: null,
  submitting: false,
});

const createEmptyBalanceEditModalState = (): BalanceEditModalState => ({
  open: false,
  transaction: null,
  amount: '',
  note: '',
  error: null,
  submitting: false,
});

const evaluateOptionSelections = (
  product: Product,
  selectionMap: OptionSelectionMap
): OptionEvaluationResult => {
  const groups = Array.isArray(product.options) ? product.options : [];
  const productSelections: ProductOptionSelection[] = [];
  const transactionSelections: TransactionOptionSelection[] = [];
  const missingRequired: string[] = [];
  let totalDelta = 0;

  groups.forEach((group) => {
    if (!group || typeof group.id !== 'string') {
      return;
    }

    const selectedIds = Array.isArray(selectionMap[group.id]) ? selectionMap[group.id] : [];
    const normalized: string[] = [];
    const resolvedChoices: TransactionOptionSelection['choices'] = [];
    const seen = new Set<string>();

    for (const rawId of selectedIds) {
      if (typeof rawId !== 'string') {
        continue;
      }
      const trimmed = rawId.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      const match = group.choices.find((choice) => choice.id === trimmed);
      if (!match) {
        continue;
      }

      normalized.push(match.id);
      resolvedChoices.push({
        id: match.id,
        label: match.label,
        priceDelta:
          typeof match.priceDelta === 'number' && Number.isFinite(match.priceDelta)
            ? match.priceDelta
            : 0,
      });
      seen.add(trimmed);

      if (!group.multiple) {
        break;
      }
    }

    if (group.required && normalized.length === 0) {
      missingRequired.push(group.name);
    }

    if (normalized.length === 0) {
      return;
    }

    const groupDelta = resolvedChoices.reduce((sum, choice) => sum + choice.priceDelta, 0);
    totalDelta += groupDelta;

    productSelections.push({ groupId: group.id, choiceIds: normalized });
    transactionSelections.push({
      groupId: group.id,
      groupName: group.name,
      multiple: group.multiple,
      required: group.required,
      choices: resolvedChoices,
      delta: groupDelta,
    });
  });

  return {
    productSelections,
    transactionSelections,
    totalDelta,
    missingRequired,
  };
};

const calculatePurchasePreview = (
  product: Product | null,
  selectionMap: OptionSelectionMap,
  customer: Customer | null,
  globalDiscount: { percent: number; flat: number }
): PurchasePreview | null => {
  if (!product) {
    return null;
  }

  const evaluation = evaluateOptionSelections(product, selectionMap);
  const basePrice = roundCurrency(product.price);
  const optionsDelta = roundCurrency(evaluation.totalDelta);
  const subtotal = roundCurrency(basePrice + optionsDelta);
  let current = subtotal;
  const discounts: DiscountLine[] = [];

  const applyPercent = (label: string, value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return;
    }
    const bounded = Math.min(100, Math.max(0, value));
    if (bounded <= 0) {
      return;
    }
    const discount = roundCurrency(current * (bounded / 100));
    if (discount <= 0) {
      return;
    }
    current = roundCurrency(Math.max(0, current - discount));
    discounts.push({ label: `${label} (${bounded.toFixed(2).replace(/\.00$/, '')}% off)`, amount: discount });
  };

  const applyFlat = (label: string, value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return;
    }
    const bounded = Math.max(0, value);
    if (bounded <= 0) {
      return;
    }
    const discount = roundCurrency(Math.min(current, bounded));
    if (discount <= 0) {
      return;
    }
    current = roundCurrency(Math.max(0, current - discount));
    discounts.push({ label: `${label} (flat)`, amount: discount });
  };

  applyPercent('Global discount', globalDiscount.percent);
  applyFlat('Global discount', globalDiscount.flat);
  applyPercent('Product discount', product.discount_percent ?? 0);
  applyFlat('Product discount', product.discount_flat ?? 0);
  applyPercent('Customer discount', customer?.discount_percent ?? 0);
  applyFlat('Customer discount', customer?.discount_flat ?? 0);
  applyPercent('Customer type discount', customer?.type_discount_percent ?? 0);
  applyFlat('Customer type discount', customer?.type_discount_flat ?? 0);

  const finalTotal = roundCurrency(Math.max(0, current));

  return {
    evaluation,
    basePrice,
    optionsDelta,
    subtotal,
    discounts,
    finalTotal,
  };
};

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
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
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
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);
  const [unvoidingTransactionId, setUnvoidingTransactionId] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettingsPayload | null>(null);
  const [appSettingsError, setAppSettingsError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [optionModalState, setOptionModalState] = useState<OptionModalState>(() =>
    createEmptyOptionModalState()
  );
  const [editModalState, setEditModalState] = useState<EditModalState>(() =>
    createEmptyEditModalState()
  );
  const [balanceEditModalState, setBalanceEditModalState] = useState<BalanceEditModalState>(() =>
    createEmptyBalanceEditModalState()
  );

  const entryInputRef = useRef<HTMLInputElement>(null);
  const customerIdInputRef = useRef<HTMLInputElement>(null);
  const depositInputRef = useRef<HTMLInputElement>(null);
  const adjustmentInputRef = useRef<HTMLInputElement>(null);

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    []
  );

  const formatCurrency = (amount: number) => currencyFormatter.format(amount);

  const globalDiscount = useMemo(
    () => ({
      percent:
        typeof appSettings?.globalDiscountPercent === 'number'
          ? appSettings.globalDiscountPercent
          : 0,
      flat:
        typeof appSettings?.globalDiscountFlat === 'number'
          ? appSettings.globalDiscountFlat
          : 0,
    }),
    [appSettings?.globalDiscountFlat, appSettings?.globalDiscountPercent]
  );

  const globalDiscountActive = useMemo(
    () => globalDiscount.percent > 0 || globalDiscount.flat > 0,
    [globalDiscount]
  );

  const globalDiscountSummary = useMemo(() => {
    const parts: string[] = [];
    if (globalDiscount.percent > 0) {
      parts.push(`${formatPercentLabel(globalDiscount.percent)}% off`);
    }
    if (globalDiscount.flat > 0) {
      parts.push(`${currencyFormatter.format(globalDiscount.flat)} off`);
    }
    return parts.join(' + ');
  }, [currencyFormatter, globalDiscount.flat, globalDiscount.percent]);

  const globalDiscountDetails = useMemo(() => {
    const details: string[] = [];
    if (globalDiscount.percent > 0) {
      details.push(
        `${formatPercentLabel(globalDiscount.percent)}% percent discount automatically applies to the subtotal.`
      );
    }
    if (globalDiscount.flat > 0) {
      details.push(
        `${currencyFormatter.format(globalDiscount.flat)} flat discount is deducted after percentage discounts.`
      );
    }
    return details;
  }, [currencyFormatter, globalDiscount.flat, globalDiscount.percent]);

  const optionPreview = useMemo<OptionEvaluationResult>(() => {
    if (!optionModalState.product) {
      return {
        productSelections: [],
        transactionSelections: [],
        totalDelta: 0,
        missingRequired: [],
      };
    }
    return evaluateOptionSelections(optionModalState.product, optionModalState.selections);
  }, [optionModalState.product, optionModalState.selections]);

  const optionPricePreview = useMemo(() => {
    if (!optionModalState.product) {
      return null;
    }
    return calculatePurchasePreview(
      optionModalState.product,
      optionModalState.selections,
      state.currentCustomer,
      globalDiscount
    );
  }, [globalDiscount, optionModalState.product, optionModalState.selections, state.currentCustomer]);

  const optionSubtotal = useMemo(() => {
    if (!optionModalState.product) {
      return 0;
    }
    if (optionPricePreview) {
      return optionPricePreview.subtotal;
    }
    return roundCurrency(optionModalState.product.price + optionPreview.totalDelta);
  }, [optionModalState.product, optionPricePreview, optionPreview.totalDelta]);

  const optionMissingGroups = useMemo(() => {
    return new Set(optionPreview.missingRequired);
  }, [optionPreview.missingRequired]);

  const optionEstimatedTotal = useMemo(() => {
    return optionPricePreview?.finalTotal ?? 0;
  }, [optionPricePreview]);

  const optionConfirmDisabled = useMemo(() => {
    const hasSelectableOptions = (optionModalState.product?.options?.length ?? 0) > 0;
    return optionModalState.submitting || (hasSelectableOptions && optionPreview.missingRequired.length > 0);
  }, [optionModalState.product, optionModalState.submitting, optionPreview.missingRequired.length]);

  const editOptionPreview = useMemo<OptionEvaluationResult>(() => {
    if (!editModalState.product) {
      return {
        productSelections: [],
        transactionSelections: [],
        totalDelta: 0,
        missingRequired: [],
      };
    }
    return evaluateOptionSelections(editModalState.product, editModalState.selections);
  }, [editModalState.product, editModalState.selections]);

  const editOptionMissingGroups = useMemo(() => {
    return new Set(editOptionPreview.missingRequired);
  }, [editOptionPreview.missingRequired]);

  const editPricePreview = useMemo(() => {
    if (!editModalState.product) {
      return null;
    }
    return calculatePurchasePreview(
      editModalState.product,
      editModalState.selections,
      state.currentCustomer,
      globalDiscount
    );
  }, [editModalState.product, editModalState.selections, globalDiscount, state.currentCustomer]);

  const editSubtotal = useMemo(() => {
    if (!editModalState.product) {
      return 0;
    }
    if (editPricePreview) {
      return editPricePreview.subtotal;
    }
    return roundCurrency(editModalState.product.price + editOptionPreview.totalDelta);
  }, [editModalState.product, editOptionPreview.totalDelta, editPricePreview]);

  const editEstimatedTotal = useMemo(() => {
    return editPricePreview?.finalTotal ?? 0;
  }, [editPricePreview]);

  const editConfirmDisabled = useMemo(() => {
    const hasSelectableOptions = (editModalState.product?.options?.length ?? 0) > 0;
    return (
      editModalState.submitting ||
      !editModalState.product ||
      editModalState.productId.trim().length === 0 ||
      (hasSelectableOptions && editOptionPreview.missingRequired.length > 0)
    );
  }, [
    editModalState.product,
    editModalState.productId,
    editModalState.submitting,
    editOptionPreview.missingRequired.length,
  ]);

  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

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
    void loadAppSettings();
  }, []);

  useEffect(() => {
    setState({ ...INITIAL_POS_STATE });
    setCustomerIdInput('');
    setEntryInput('');
    setDepositAmount('');
    setAdjustmentAmount('');
  setNote('');
    setShowAdjustmentForm(false);
    if (trainingMode) {
      setTrainingCustomers(buildPresetTrainingCustomers());
    }
    setActiveTrainingCustomerId(null);
    setOptionModalState(createEmptyOptionModalState());
  }, [trainingMode]);

  useEffect(() => {
    if (state.currentCustomer && entryInputRef.current) {
      entryInputRef.current.focus();
    }
  }, [state.currentCustomer]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) {
        return false;
      }
      if (target.isContentEditable) {
        return true;
      }
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const focusWithSelection = (ref: React.RefObject<HTMLInputElement>) => {
      if (!ref.current) {
        return;
      }
      ref.current.focus();
      ref.current.select();
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      if (!event.shiftKey || !(event.ctrlKey || event.metaKey)) {
        return;
      }

      switch (event.key) {
        case '1':
          event.preventDefault();
          focusWithSelection(customerIdInputRef);
          break;
        case '2':
          event.preventDefault();
          focusWithSelection(entryInputRef);
          break;
        case '3':
          event.preventDefault();
          focusWithSelection(depositInputRef);
          break;
        case '4':
          event.preventDefault();
          setShowAdjustmentForm(true);
          window.setTimeout(() => focusWithSelection(adjustmentInputRef), 0);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [setShowAdjustmentForm]);

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

  const loadAppSettings = async () => {
    try {
      const response = await fetch('/api/settings/app');
      if (!response.ok) {
        throw new Error('Unable to load app settings');
      }
      const data: AppSettingsPayload = await response.json();
      setAppSettings(data);
      setAppSettingsError(null);
    } catch (error) {
      console.error('Failed to load app settings', error);
      setAppSettings(null);
      setAppSettingsError('Unable to load global discount settings.');
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
    setShowProductDropdown(false);
    setState((prev) => ({ ...prev, error: null }));
    if (entryInputRef.current) {
      entryInputRef.current.focus();
    }
  };

  const openOptionModal = (product: Product, trigger: PurchaseTrigger) => {
    setOptionModalState({
      open: true,
      product,
      trigger,
      selections: createInitialSelectionMap(product),
      error: null,
      submitting: false,
    });
  };

  const closeOptionModal = () => {
    setOptionModalState((prev) => {
      if (prev.submitting) {
        return prev;
      }
      return createEmptyOptionModalState();
    });
  };

  const toggleOptionChoice = (group: ProductOptionGroup, choiceId: string) => {
    setOptionModalState((prev) => {
      if (!prev.product || prev.submitting || typeof group.id !== 'string') {
        return prev;
      }

      const trimmed = typeof choiceId === 'string' ? choiceId.trim() : '';
      if (!trimmed) {
        return prev;
      }

      const current = Array.isArray(prev.selections[group.id]) ? prev.selections[group.id] : [];
      let next: string[];

      if (group.multiple) {
        next = current.includes(trimmed)
          ? current.filter((id) => id !== trimmed)
          : [...current, trimmed];
      } else {
        next = current.includes(trimmed) ? [] : [trimmed];
      }

      return {
        ...prev,
        error: null,
        selections: {
          ...prev.selections,
          [group.id]: next,
        },
      };
    });
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
    selectedOptions,
    productOverride,
  }: {
    barcode?: string;
    productId?: string;
    selectedOptions?: ProductOptionSelection[] | null;
    productOverride?: Product | null;
  }): Promise<boolean> => {
    if (!state.currentCustomer || (!barcode && !productId)) {
      return false;
    }

    const customerId = state.currentCustomer.customer_id;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    if (trainingMode) {
      const entry = trainingCustomers[customerId];
      if (!entry) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Training customer not found' }));
        return false;
      }

      const product =
        productOverride ??
        (productId
          ? resolveProductById(productId)
          : barcode
          ? resolveProductByBarcode(barcode)
          : null);

      if (!product) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Product not found' }));
        return false;
      }

      const selectionMap = buildSelectionMapFromProductSelections(product, selectedOptions);
      const evaluation = evaluateOptionSelections(product, selectionMap);
      const hasOptions = Array.isArray(product.options) && product.options.length > 0;

      if (hasOptions && evaluation.missingRequired.length > 0) {
        const uniqueGroups = Array.from(new Set(evaluation.missingRequired));
        const message =
          uniqueGroups.length === 1
            ? `Select an option for ${uniqueGroups[0]}.`
            : `Select options for ${uniqueGroups.join(', ')}.`;
        setState((prev) => ({ ...prev, isLoading: false, error: message }));
        return false;
      }

      const currentBalance = roundCurrency(entry.customer.balance);
      const basePrice = roundCurrency(product.price);
      const optionsDelta = roundCurrency(evaluation.totalDelta);
      const finalPrice = roundCurrency(basePrice + optionsDelta);

      if (currentBalance + 0.00001 < finalPrice) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Insufficient balance' }));
        return false;
      }

      let amount = finalPrice === 0 ? 0 : -finalPrice;
      amount = roundCurrency(amount);
      let newBalance = roundCurrency(currentBalance + amount);
      if (Object.is(newBalance, -0)) {
        newBalance = 0;
      }

      const timestamp = new Date().toISOString();
      const transaction: TransactionLog = {
        id: Date.now(),
        transaction_id: `TRAIN_PURCHASE_${Date.now()}`,
        customer_id: customerId,
        type: 'purchase',
        product_id: product.product_id,
        amount,
        balance_after: newBalance,
        note: undefined,
        timestamp,
        staff_id: undefined,
        product_name: product.name,
        options: evaluation.transactionSelections.length
          ? evaluation.transactionSelections
          : undefined,
      };

      updateTrainingEntry(customerId, (current) => ({
        customer: { ...current.customer, balance: transaction.balance_after, updated_at: timestamp },
        transactions: [transaction, ...current.transactions].slice(0, MAX_TRAINING_TRANSACTIONS),
        autoBalance: current.autoBalance,
      }));
      clearEntryInput();
      return true;
    }

    try {
      const payload = {
        customerId,
        barcode,
        productId,
        selectedOptions:
          Array.isArray(selectedOptions) && selectedOptions.length > 0
            ? selectedOptions
            : undefined,
      };

      const response = await fetch('/api/transactions/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.error === 'string' ? data.error : 'Purchase failed';
        throw new Error(message);
      }

      await loadCustomer(customerId);
      clearEntryInput();
      return true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Purchase failed',
      }));
      return false;
    }
  };

  const startProductPurchase = (product: Product, trigger: PurchaseTrigger) => {
    if (!state.currentCustomer || state.isLoading) {
      return;
    }

    if (Array.isArray(product.options) && product.options.length > 0) {
      openOptionModal(product, trigger);
      return;
    }

    void handlePurchase({ ...trigger, productOverride: product });
  };

  const handleOptionModalConfirm = async () => {
    if (!optionModalState.product || !optionModalState.trigger || state.isLoading) {
      return;
    }

    const evaluation = evaluateOptionSelections(optionModalState.product, optionModalState.selections);
    const hasOptions =
      Array.isArray(optionModalState.product.options) && optionModalState.product.options.length > 0;

    if (hasOptions && evaluation.missingRequired.length > 0) {
      const uniqueGroups = Array.from(new Set(evaluation.missingRequired));
      const message =
        uniqueGroups.length === 1
          ? `Select an option for ${uniqueGroups[0]}.`
          : `Select options for ${uniqueGroups.join(', ')}.`;
      setOptionModalState((prev) => ({ ...prev, error: message }));
      return;
    }

    setOptionModalState((prev) => ({ ...prev, submitting: true, error: null }));
    const success = await handlePurchase({
      ...optionModalState.trigger,
      selectedOptions: evaluation.productSelections,
      productOverride: optionModalState.product,
    });

    if (success) {
      setOptionModalState(createEmptyOptionModalState());
    } else {
      setOptionModalState((prev) => ({ ...prev, submitting: false }));
    }
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

    startProductPurchase(product, { productId: product.product_id });
  };

  const openPurchaseEditModal = (transaction: TransactionLog) => {
    if (trainingMode || transaction.type !== 'purchase' || !transaction.transaction_id) {
      return;
    }

    setState((prev) => ({ ...prev, error: null }));

    const resolvedProduct = transaction.product_id
      ? resolveProductById(transaction.product_id)
      : null;

    let selections: OptionSelectionMap = {};
    let error: string | null = null;

    if (resolvedProduct) {
      const initialMap = createInitialSelectionMap(resolvedProduct);
      const previousSelections = buildSelectionMapFromProductSelections(
        resolvedProduct,
        transactionOptionsToProductSelections(transaction.options)
      );
      selections = { ...initialMap, ...previousSelections };
    } else {
      error = 'Original product is no longer available. Select a replacement to continue.';
    }

    setEditModalState({
      ...createEmptyEditModalState(),
      open: true,
      transaction,
      product: resolvedProduct,
      productId: resolvedProduct?.product_id ?? transaction.product_id ?? '',
      selections,
      note: transaction.note ?? '',
      error,
    });
  };

  const openBalanceEditModal = (transaction: TransactionLog) => {
    if (
      trainingMode ||
      !transaction.transaction_id ||
      (transaction.type !== 'deposit' && transaction.type !== 'adjustment')
    ) {
      return;
    }

    const initialAmount = Number.isFinite(transaction.amount)
      ? roundCurrency(transaction.amount).toString()
      : '';

    setState((prev) => ({ ...prev, error: null }));
    setBalanceEditModalState({
      ...createEmptyBalanceEditModalState(),
      open: true,
      transaction,
      amount: initialAmount,
      note: transaction.note ?? '',
    });
  };

  const closeEditModal = () => {
    setEditModalState((prev) => {
      if (prev.submitting) {
        return prev;
      }
      return createEmptyEditModalState();
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

  const handleEditModalProductChange = (productId: string) => {
    setEditModalState((prev) => {
      if (prev.submitting) {
        return prev;
      }

      const trimmed = productId.trim();
      if (!trimmed) {
        return {
          ...prev,
          productId: '',
          product: null,
          selections: {},
          error: 'Select a product to continue.',
        };
      }

      const product = resolveProductById(trimmed);
      if (!product) {
        return {
          ...prev,
          productId: trimmed,
          product: null,
          selections: {},
          error: 'Selected product is unavailable.',
        };
      }

      const nextSelections =
        prev.product && prev.product.product_id === product.product_id
          ? { ...prev.selections }
          : createInitialSelectionMap(product);

      return {
        ...prev,
        productId: trimmed,
        product,
        selections: nextSelections,
        error: null,
      };
    });
  };

  const toggleEditOptionChoice = (group: ProductOptionGroup, choiceId: string) => {
    setEditModalState((prev) => {
      if (!prev.product || prev.submitting || typeof group.id !== 'string') {
        return prev;
      }

      const trimmed = typeof choiceId === 'string' ? choiceId.trim() : '';
      if (!trimmed) {
        return prev;
      }

      const current = Array.isArray(prev.selections[group.id]) ? prev.selections[group.id] : [];
      let next: string[];

      if (group.multiple) {
        next = current.includes(trimmed)
          ? current.filter((id) => id !== trimmed)
          : [...current, trimmed];
      } else {
        next = current.includes(trimmed) ? [] : [trimmed];
      }

      return {
        ...prev,
        error: null,
        selections: {
          ...prev.selections,
          [group.id]: next,
        },
      };
    });
  };

  const handleEditModalSubmit = async () => {
    if (!editModalState.open || !editModalState.transaction || trainingMode) {
      return;
    }

    const transactionId = editModalState.transaction.transaction_id;
    if (!transactionId) {
      setEditModalState((prev) => ({ ...prev, error: 'Unable to edit this transaction.' }));
      return;
    }

    const customerId = editModalState.transaction.customer_id;
    const trimmedProductId = editModalState.productId.trim();

    if (!trimmedProductId) {
      setEditModalState((prev) => ({ ...prev, error: 'Select a product to continue.' }));
      return;
    }

    const product = editModalState.product ?? resolveProductById(trimmedProductId);
    if (!product) {
      setEditModalState((prev) => ({ ...prev, error: 'Selected product is unavailable.' }));
      return;
    }

    const preview =
      editPricePreview ??
      calculatePurchasePreview(product, editModalState.selections, state.currentCustomer, globalDiscount);

    if (!preview) {
      setEditModalState((prev) => ({ ...prev, error: 'Unable to calculate updated price.' }));
      return;
    }

    const evaluation = preview.evaluation;
    const hasOptions = (product.options?.length ?? 0) > 0;

    if (hasOptions && evaluation.missingRequired.length > 0) {
      const uniqueGroups = Array.from(new Set(evaluation.missingRequired));
      const message =
        uniqueGroups.length === 1
          ? `Select an option for ${uniqueGroups[0]}.`
          : `Select options for ${uniqueGroups.join(', ')}.`;
      setEditModalState((prev) => ({ ...prev, error: message }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    setEditModalState((prev) => ({ ...prev, submitting: true, error: null }));

    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          productId: product.product_id,
          note: editModalState.note,
          selectedOptions: evaluation.productSelections,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'Failed to update transaction'
        );
      }

      await loadCustomer(customerId);
      setEditModalState(createEmptyEditModalState());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update transaction';
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
      setEditModalState((prev) => ({ ...prev, submitting: false, error: message }));
    }
  };

  const handleBalanceEditSubmit = async () => {
    if (!balanceEditModalState.open || !balanceEditModalState.transaction || trainingMode) {
      return;
    }

    const transactionId = balanceEditModalState.transaction.transaction_id;
    if (!transactionId) {
      setBalanceEditModalState((prev) => ({ ...prev, error: 'Unable to edit this entry.' }));
      return;
    }

    const parsedAmount = Number.parseFloat(balanceEditModalState.amount);
    if (!Number.isFinite(parsedAmount)) {
      setBalanceEditModalState((prev) => ({ ...prev, error: 'Enter a valid amount.' }));
      return;
    }

    const normalizedNote = balanceEditModalState.note.trim();
    const customerId = balanceEditModalState.transaction.customer_id;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    setBalanceEditModalState((prev) => ({ ...prev, submitting: true, error: null }));

    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(transactionId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionType: 'balance-delta',
          customerId,
          amount: parsedAmount,
          note: normalizedNote || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'Failed to update transaction'
        );
      }

      await loadCustomer(customerId);
      setBalanceEditModalState(createEmptyBalanceEditModalState());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update transaction';
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
      setBalanceEditModalState((prev) => ({ ...prev, submitting: false, error: message }));
    }
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
      setShowProductDropdown(false);
      startProductPurchase(barcodeMatch, { barcode: trimmed });
      return;
    }

    const productMatch = resolveProductById(trimmed);
    if (productMatch) {
      setShowProductDropdown(false);
      startProductPurchase(productMatch, { productId: productMatch.product_id });
      return;
    }

    const firstSuggestion = productSuggestions[0];
    if (firstSuggestion) {
      setShowProductDropdown(false);
      setEntryInput(firstSuggestion.name);
      setState((prev) => ({ ...prev, error: null }));
      startProductPurchase(firstSuggestion, { productId: firstSuggestion.product_id });
      return;
    }

    setShowProductDropdown(true);
    setState((prev) => ({ ...prev, error: 'Product not found. Try a suggestion below.' }));
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

  const handleUnvoidTransaction = async (transaction: TransactionLog) => {
    if (!state.currentCustomer || trainingMode) {
      return;
    }

    const id = transaction.transaction_id;
    if (!id) {
      setState((prev) => ({ ...prev, error: 'This entry cannot be updated because it is missing an ID.' }));
      return;
    }

    setState((prev) => ({ ...prev, error: null }));
    setUnvoidingTransactionId(id);
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unvoid' }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'Failed to unvoid transaction'
        );
      }

      await loadCustomer(state.currentCustomer.customer_id);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to unvoid transaction',
      }));
    } finally {
      setUnvoidingTransactionId(null);
    }
  };

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
  const exportTransactionsToCsv = async () => {
    if (exportingCsv) {
      return;
    }

    setExportingCsv(true);
    try {
      const adminCode = getAdminCode();
      const response = await fetch('/api/transactions/export', {
        headers: adminCode ? { 'x-admin-code': adminCode } : undefined,
      });
      if (response.status === 401) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof (payload as { error?: string })?.error === 'string'
            ? (payload as { error?: string }).error
            : 'Admin code required to export transactions';
        throw new Error(message);
      }
      if (!response.ok) {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const payload = await response.json().catch(() => ({}));
          throw new Error((payload as { error?: string })?.error ?? 'Failed to export transactions');
        }
        const fallback = await response.text().catch(() => 'Failed to export transactions');
        throw new Error(fallback || 'Failed to export transactions');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const fallbackName = `transactions-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      link.href = url;
      link.setAttribute('download', match?.[1] ?? fallbackName);
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to export transactions',
      }));
    } finally {
      setExportingCsv(false);
    }
  };

  const filteredQuickKeys = quickKeySlots.filter((slot) => slot.productId);

  const renderQuickKey = (slot: QuickKeySlot) => {
    const product = slot.product ?? (slot.productId ? resolveProductById(slot.productId) : null);
    if (!product) {
      return (
        <button
          key={slot.index}
          className="h-24 w-full rounded-xl border border-dashed border-gray-300 bg-white text-gray-400"
          type="button"
        >
          Empty
        </button>
      );
    }

    return (
      <button
        key={slot.index}
        className="flex h-24 w-full flex-col justify-between overflow-hidden rounded-xl border border-gray-200 bg-white p-3 text-left shadow hover:border-camp-500 hover:shadow-md"
        onClick={() => handleQuickKeyPurchase(slot)}
        type="button"
      >
        <span className="font-semibold text-gray-800 truncate">{product.name}</span>
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
  const shellClassName = trainingMode
    ? 'flex min-h-screen flex-col bg-amber-50'
    : 'flex min-h-screen flex-col bg-gray-50';

  return (
    <div className={shellClassName}>
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
          </div>
        </div>
      </header>
      {trainingMode ? (
        <div className="border-b border-amber-200 bg-amber-100/60 px-6 py-3 text-sm text-amber-900">
          <span className="font-semibold">Training mode is active.</span> Transactions are simulated and do not affect the live database.
        </div>
      ) : null}
      <main className="flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {appSettingsError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {appSettingsError}
          </div>
        ) : null}

        {globalDiscountActive ? (
          <section className="rounded-lg border border-camp-200 bg-camp-50 px-4 py-3 text-sm text-camp-800">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-semibold text-camp-900">
                Global discount currently applies to all purchases.
              </span>
              {globalDiscountSummary ? (
                <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-camp-700 shadow-sm">
                  {globalDiscountSummary}
                </span>
              ) : null}
            </div>
            {globalDiscountDetails.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {globalDiscountDetails.map((detail) => (
                  <li key={detail} className="text-xs text-camp-700">
                    {detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(320px,1fr)_minmax(520px,760px)] xl:grid-cols-[minmax(320px,1fr)_minmax(520px,760px)_minmax(320px,1fr)] xl:items-start">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow xl:col-start-1 xl:row-start-1">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Quick Keys</h2>
                <p className="text-sm text-gray-500">Pre-configured products for rapid checkout.</p>
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
            <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
              {canUseQuickKeys ? (
                renderQuickKeyGrid()
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500">
                  Lookup a customer to enable quick keys.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow lg:col-start-2 lg:row-start-1 xl:col-start-2">
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
                      ref={customerIdInputRef}
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
                          setState((prev) => ({ ...prev, error: null }));
                        }}
                        onFocus={() => setShowProductDropdown(true)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handlePrimaryCharge();
                          }
                        }}
                        placeholder="Scan barcode or search by name/ID"
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
                              if (!state.currentCustomer || state.isLoading) {
                                return;
                              }
                              setEntryInput(product.name);
                              setShowProductDropdown(false);
                              setState((prev) => ({ ...prev, error: null }));
                              startProductPurchase(product, { productId: product.product_id });
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
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Shortcuts: Ctrl+Shift+1 customer lookup, Ctrl+Shift+2 scan/search, Ctrl+Shift+3 deposit, Ctrl+Shift+4 adjustment.
              </p>

              {productsLoading ? (
                <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500">
                  Loading products
                </div>
              ) : (
                <div className="mt-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-600">
                    Press Enter to charge a scanned barcode immediately, or pick from the suggestions below.
                  </p>
                  <button
                    className="self-start rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 shadow hover:border-camp-500 sm:self-auto"
                    disabled={state.isLoading}
                    onClick={clearEntryInput}
                    type="button"
                  >
                    Clear Input
                  </button>
                </div>
              )}
            </section>

          <aside className="space-y-6 lg:col-span-2 lg:row-start-2 xl:col-span-1 xl:col-start-3 xl:row-start-1">
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
                      ref={depositInputRef}
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
                          ref={adjustmentInputRef}
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
                  className="text-sm font-semibold text-camp-600 hover:text-camp-700 disabled:opacity-60"
                  disabled={exportingCsv}
                  onClick={exportTransactionsToCsv}
                  type="button"
                >
                  {exportingCsv ? 'Preparing CSV...' : 'Export All Transactions'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Downloads every transaction on file, not just this customer&rsquo;s activity.
              </p>
              {trainingMode ? (
                <p className="mt-2 text-xs text-gray-500">
                  Editing and voiding are disabled in training mode. Switch back to live mode to manage transactions.
                </p>
              ) : null}

              {!trainingMode && globalDiscountActive ? (
                <p className="mt-2 text-xs font-semibold text-camp-700">
                  Global discount is active - recent totals already include the automatic adjustment.
                </p>
              ) : null}

              {state.recentTransactions.length ? (
                <div className="mt-4 space-y-3">
                  {filteredTransactions.map((transaction) => {
                    const amountPositive = transaction.amount >= 0;
                    const canDelete =
                      !trainingMode &&
                      Boolean(transaction.transaction_id) &&
                      !transaction.voided;
                    const canEditPurchase =
                      !trainingMode &&
                      transaction.type === 'purchase' &&
                      Boolean(transaction.transaction_id) &&
                      !transaction.voided;
                    const canEditBalanceDelta =
                      !trainingMode &&
                      (transaction.type === 'deposit' || transaction.type === 'adjustment') &&
                      Boolean(transaction.transaction_id) &&
                      !transaction.voided;
                    const isDeleting =
                      canDelete && deletingTransactionId === transaction.transaction_id;
                    const canUnvoid =
                      !trainingMode &&
                      transaction.voided &&
                      Boolean(transaction.transaction_id);
                    const isUnvoiding =
                      canUnvoid && unvoidingTransactionId === transaction.transaction_id;
                    const amountClass = transaction.voided
                      ? 'text-sm font-semibold text-gray-400 line-through'
                      : `text-sm font-semibold ${amountPositive ? 'text-camp-600' : 'text-red-600'}`;
                    const isEdited = Boolean(transaction.edit_parent_transaction_id);
                    const baseLabel = transaction.type === 'purchase'
                      ? transaction.product_name ?? 'Purchase'
                      : transaction.type === 'deposit'
                      ? 'Deposit'
                      : 'Adjustment';
                    const primaryLabel = isEdited ? 'Edit' : baseLabel;
                    const supportingLabel = isEdited ? baseLabel : null;
                    const renderedNote = isEdited
                      ? `Edit${transaction.note ? `: ${transaction.note}` : ''}`
                      : transaction.note ?? null;

                    return (
                      <div
                        key={transaction.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{primaryLabel}</p>
                            {supportingLabel ? (
                              <p className="text-xs text-gray-500">{supportingLabel}</p>
                            ) : null}
                            {renderedNote ? (
                              <p className="text-xs text-gray-500">{renderedNote}</p>
                            ) : null}
                            {Array.isArray(transaction.options) && transaction.options.length ? (
                              <div className="mt-2 space-y-1">
                                {transaction.options.map((option) => (
                                  <p key={option.groupId} className="text-xs text-gray-500">
                                    <span className="font-semibold text-gray-600">{option.groupName}:</span>{' '}
                                    {option.choices.map((choice) => choice.label).join(', ')}
                                    {option.delta !== 0
                                      ? ` (${option.delta > 0 ? '+' : '-'}${formatCurrency(
                                          Math.abs(option.delta)
                                        )})`
                                      : ''}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                            {transaction.void_note ? (
                              <p className="mt-2 text-xs font-semibold text-red-600">
                                Void note: {transaction.void_note}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-2 text-right sm:flex-row sm:items-center sm:gap-3">
                            <span className={amountClass}>
                              {amountPositive
                                ? `+${formatCurrency(transaction.amount)}`
                                : `-${formatCurrency(Math.abs(transaction.amount))}`}
                            </span>
                            {isEdited ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-700">
                                Edited
                              </span>
                            ) : null}
                            {transaction.voided ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-700">
                                Voided
                              </span>
                            ) : null}
                            {canEditPurchase ? (
                              <button
                                className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm hover:border-camp-500 hover:text-camp-700"
                                disabled={state.isLoading}
                                onClick={() => openPurchaseEditModal(transaction)}
                                type="button"
                              >
                                Edit
                              </button>
                            ) : null}
                            {!canEditPurchase && canEditBalanceDelta ? (
                              <button
                                className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm hover:border-camp-500 hover:text-camp-700"
                                disabled={state.isLoading}
                                onClick={() => openBalanceEditModal(transaction)}
                                type="button"
                              >
                                Edit
                              </button>
                            ) : null}
                            {canDelete ? (
                              <button
                                className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm hover:border-red-400 hover:text-red-600"
                                disabled={isDeleting || state.isLoading}
                                onClick={() => handleDeleteTransaction(transaction)}
                                type="button"
                              >
                                {isDeleting ? 'Removing...' : 'Void'}
                              </button>
                            ) : null}
                            {canUnvoid ? (
                              <button
                                className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm hover:border-camp-400 hover:text-camp-700"
                                disabled={isUnvoiding || state.isLoading}
                                onClick={() => handleUnvoidTransaction(transaction)}
                                type="button"
                              >
                                {isUnvoiding ? 'Restoring...' : 'Unvoid'}
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

      <Dialog open={optionModalState.open} onClose={closeOptionModal}>
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl">
            {optionModalState.product ? (
              <>
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Customize {optionModalState.product.name}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-gray-500">
                  Choose the applicable options before completing this purchase.
                </Dialog.Description>

                <div className="mt-4 space-y-4">
                  {optionModalState.product.options?.map((group) => {
                    const groupId = group.id;
                    const selectedIds = Array.isArray(optionModalState.selections[groupId])
                      ? optionModalState.selections[groupId]
                      : [];
                    const missing = optionMissingGroups.has(group.name);

                    return (
                      <div key={groupId} className="rounded-lg border border-gray-200 p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm font-semibold text-gray-800">{group.name}</p>
                          <div className="flex items-center gap-2 text-xs">
                            {group.required ? (
                              <span className={missing ? 'font-semibold text-red-600' : 'font-semibold text-camp-600'}>
                                Required
                              </span>
                            ) : (
                              <span className="text-gray-400">Optional</span>
                            )}
                            {group.multiple ? (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                                Multiple
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {group.choices.map((choice) => {
                            const delta =
                              typeof choice.priceDelta === 'number' && Number.isFinite(choice.priceDelta)
                                ? choice.priceDelta
                                : 0;
                            const isSelected = selectedIds.includes(choice.id);
                            return (
                              <button
                                key={choice.id}
                                className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition ${
                                  isSelected
                                    ? 'border-camp-500 bg-camp-50 text-camp-700 shadow'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-camp-400'
                                }`}
                                disabled={optionModalState.submitting}
                                onClick={() => toggleOptionChoice(group, choice.id)}
                                type="button"
                              >
                                <span className="font-medium">{choice.label}</span>
                                <span className="text-xs text-gray-500">
                                  {delta === 0
                                    ? 'No change'
                                    : delta > 0
                                    ? `+${formatCurrency(delta)}`
                                    : `-${formatCurrency(Math.abs(delta))}`}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {optionModalState.error ? (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {optionModalState.error}
                  </div>
                ) : null}

                {globalDiscountActive ? (
                  <p className="mt-6 text-xs font-semibold text-camp-700">
                    Global discount applies automatically to this charge.
                  </p>
                ) : null}
                <div className={`rounded-lg bg-gray-50 px-4 py-3 text-sm ${globalDiscountActive ? 'mt-3' : 'mt-6'}`}>
                  <div className="flex items-center justify-between">
                    <span>Base Price</span>
                    <span>{formatCurrency(optionModalState.product.price)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Options</span>
                    <span className={optionPreview.totalDelta >= 0 ? 'text-camp-600' : 'text-red-600'}>
                      {optionPreview.totalDelta === 0
                        ? formatCurrency(0)
                        : `${optionPreview.totalDelta > 0 ? '+' : '-'}${formatCurrency(
                            Math.abs(optionPreview.totalDelta)
                          )}`}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-gray-700">
                    <span>Subtotal</span>
                    <span>{formatCurrency(optionSubtotal)}</span>
                  </div>
                  {optionPricePreview?.discounts.length ? (
                    <div className="mt-2 space-y-1 border-t border-gray-200 pt-2">
                      {optionPricePreview.discounts.map((discount) => (
                        <div
                          key={discount.label}
                          className="flex items-center justify-between text-xs text-camp-700"
                        >
                          <span>{discount.label}</span>
                          <span>-{formatCurrency(discount.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div
                    className={`mt-2 flex items-center justify-between text-sm font-semibold text-gray-900 ${
                      optionPricePreview?.discounts.length ? '' : 'border-t border-gray-200 pt-2'
                    }`}
                  >
                    <span>Estimated Total</span>
                    <span>{formatCurrency(optionEstimatedTotal)}</span>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 shadow hover:border-camp-500"
                    disabled={optionModalState.submitting}
                    onClick={closeOptionModal}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-lg bg-camp-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-camp-700 disabled:opacity-70"
                    disabled={optionConfirmDisabled}
                    onClick={() => void handleOptionModalConfirm()}
                    type="button"
                  >
                    {optionModalState.submitting
                      ? 'Charging...'
                      : `Charge ${formatCurrency(optionEstimatedTotal)}`}
                  </button>
                </div>
              </>
            ) : null}
          </Dialog.Panel>
        </div>
      </Dialog>

      <Dialog open={editModalState.open} onClose={closeEditModal}>
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
            {editModalState.transaction ? (
              <>
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Update Purchase
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-gray-500">
                  Adjust the product, options, or note. The original purchase will be voided automatically.
                </Dialog.Description>

                <div className="mt-4 space-y-5">
                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="edit-product">
                      Product
                    </label>
                    <select
                      className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                      disabled={editModalState.submitting}
                      id="edit-product"
                      onChange={(event) => handleEditModalProductChange(event.target.value)}
                      value={editModalState.productId}
                    >
                      <option value="">Select a product</option>
                      {!sortedProducts.some((product) => product.product_id === editModalState.productId) &&
                      editModalState.productId ? (
                        <option value={editModalState.productId}>
                          {editModalState.transaction.product_name ?? editModalState.productId} (inactive)
                        </option>
                      ) : null}
                      {sortedProducts.map((product) => (
                        <option key={product.product_id} value={product.product_id}>
                          {product.name} ({formatCurrency(product.price)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {editModalState.product?.options?.length ? (
                    <div className="space-y-4">
                      {editModalState.product.options.map((group) => {
                        const groupId = group.id;
                        const selectedIds = Array.isArray(editModalState.selections[groupId])
                          ? editModalState.selections[groupId]
                          : [];
                        const missing = editOptionMissingGroups.has(group.name);

                        return (
                          <div key={groupId} className="rounded-lg border border-gray-200 p-4">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-sm font-semibold text-gray-800">{group.name}</p>
                              <div className="flex items-center gap-2 text-xs">
                                {group.required ? (
                                  <span
                                    className={
                                      missing
                                        ? 'font-semibold text-red-600'
                                        : 'font-semibold text-camp-600'
                                    }
                                  >
                                    Required
                                  </span>
                                ) : (
                                  <span className="text-gray-400">Optional</span>
                                )}
                                {group.multiple ? (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                                    Multiple
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {group.choices.map((choice) => {
                                const delta =
                                  typeof choice.priceDelta === 'number' && Number.isFinite(choice.priceDelta)
                                    ? choice.priceDelta
                                    : 0;
                                const isSelected = selectedIds.includes(choice.id);
                                return (
                                  <button
                                    key={choice.id}
                                    className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition ${
                                      isSelected
                                        ? 'border-camp-500 bg-camp-50 text-camp-700 shadow'
                                        : 'border-gray-200 bg-white text-gray-700 hover:border-camp-400'
                                    }`}
                                    disabled={editModalState.submitting}
                                    onClick={() => toggleEditOptionChoice(group, choice.id)}
                                    type="button"
                                  >
                                    <span className="font-medium">{choice.label}</span>
                                    <span className="text-xs text-gray-500">
                                      {delta === 0
                                        ? 'No change'
                                        : delta > 0
                                        ? `+${formatCurrency(delta)}`
                                        : `-${formatCurrency(Math.abs(delta))}`}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="edit-note">
                      Note (optional)
                    </label>
                    <textarea
                      className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                      disabled={editModalState.submitting}
                      id="edit-note"
                      onChange={(event) =>
                        setEditModalState((prev) => ({ ...prev, note: event.target.value }))
                      }
                      placeholder="Add context for this purchase"
                      rows={3}
                      value={editModalState.note}
                    />
                  </div>
                </div>

                {editModalState.error ? (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {editModalState.error}
                  </div>
                ) : null}

                {editModalState.product ? (
                  <>
                    {globalDiscountActive ? (
                      <p className="mt-6 text-xs font-semibold text-camp-700">
                        Global discount applies automatically when this update saves.
                      </p>
                    ) : null}
                    <div
                      className={`rounded-lg bg-gray-50 px-4 py-3 text-sm ${
                        globalDiscountActive ? 'mt-3' : 'mt-6'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>Base Price</span>
                        <span>{formatCurrency(editModalState.product.price)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span>Options</span>
                        <span className={editOptionPreview.totalDelta >= 0 ? 'text-camp-600' : 'text-red-600'}>
                          {editOptionPreview.totalDelta === 0
                            ? formatCurrency(0)
                            : `${editOptionPreview.totalDelta > 0 ? '+' : '-'}${formatCurrency(
                                Math.abs(editOptionPreview.totalDelta)
                              )}`}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-gray-700">
                        <span>Subtotal</span>
                        <span>{formatCurrency(editSubtotal)}</span>
                      </div>
                      {editPricePreview?.discounts.length ? (
                        <div className="mt-2 space-y-1 border-t border-gray-200 pt-2">
                          {editPricePreview.discounts.map((discount) => (
                            <div
                              key={discount.label}
                              className="flex items-center justify-between text-xs text-camp-700"
                            >
                              <span>{discount.label}</span>
                              <span>-{formatCurrency(discount.amount)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div
                        className={`mt-2 flex items-center justify-between text-sm font-semibold text-gray-900 ${
                          editPricePreview?.discounts.length ? '' : 'border-t border-gray-200 pt-2'
                        }`}
                      >
                        <span>Estimated Total</span>
                        <span>{formatCurrency(editEstimatedTotal)}</span>
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 shadow hover:border-camp-500"
                    disabled={editModalState.submitting}
                    onClick={closeEditModal}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-lg bg-camp-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-camp-700 disabled:opacity-70"
                    disabled={editConfirmDisabled}
                    onClick={() => void handleEditModalSubmit()}
                    type="button"
                  >
                    {editModalState.submitting ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </>
            ) : null}
          </Dialog.Panel>
        </div>
      </Dialog>

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
                    <label className="text-sm font-medium text-gray-700" htmlFor="balance-edit-amount">
                      Amount
                    </label>
                    <input
                      className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-base shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                      disabled={balanceEditModalState.submitting}
                      id="balance-edit-amount"
                      inputMode="decimal"
                      min="-1000"
                      onChange={(event) =>
                        setBalanceEditModalState((prev) => ({ ...prev, amount: event.target.value }))
                      }
                      step="0.01"
                      type="number"
                      value={balanceEditModalState.amount}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700" htmlFor="balance-edit-note">
                      Note (optional)
                    </label>
                    <textarea
                      className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm shadow-sm focus:border-camp-500 focus:outline-none focus:ring-2 focus:ring-camp-200"
                      disabled={balanceEditModalState.submitting}
                      id="balance-edit-note"
                      onChange={(event) =>
                        setBalanceEditModalState((prev) => ({ ...prev, note: event.target.value }))
                      }
                      rows={3}
                      value={balanceEditModalState.note}
                    />
                  </div>

                  {balanceEditModalState.error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {balanceEditModalState.error}
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-3">
                    <button
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm hover:border-gray-400"
                      disabled={balanceEditModalState.submitting}
                      onClick={closeBalanceEditModal}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-lg bg-camp-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-camp-700 disabled:opacity-60"
                      disabled={balanceEditModalState.submitting}
                      onClick={() => void handleBalanceEditSubmit()}
                      type="button"
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
    </div>
  );
}
