export interface Customer {
  id: number;
  customer_id: string; // 4-digit code
  name?: string; // Optional name
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  product_id: string;
  name: string;
  price: number;
  barcode?: string;
  category?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  options_json?: string | null;
  options?: ProductOptionGroup[];
}

export interface ProductOptionChoice {
  id: string;
  label: string;
}

export interface ProductOptionGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: ProductOptionChoice[];
}

export interface QuickKeySlot {
  index: number;
  productId: string | null;
  product?: Product | null;
}

export interface TransactionExportRow {
  transaction_id: string;
  timestamp: string;
  customer_id: string;
  customer_name?: string;
  type: Transaction['type'];
  product_id?: string;
  product_name?: string;
  product_price?: number;
  amount: number;
  balance_after: number;
  note?: string;
}

export interface Transaction {
  id: number;
  transaction_id: string;
  customer_id: string;
  type: 'purchase' | 'deposit' | 'withdrawal' | 'adjustment';
  product_id?: string; // Only for purchases
  amount: number; // Negative for purchases/withdrawals, positive for deposits
  balance_after: number;
  note?: string; // Optional note
  timestamp: string;
  staff_id?: string; // For future use
}

export interface TransactionLog extends Transaction {
  product_name?: string; // Joined from Products table
}

export type TransactionType = Transaction['type'];