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