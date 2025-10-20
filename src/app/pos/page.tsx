'use client';

import React, { useState, useRef } from 'react';
import { Customer, TransactionLog } from '@/types/database';

interface POSState {
  currentCustomer: Customer | null;
  recentTransactions: TransactionLog[];
  isLoading: boolean;
  error: string | null;
}

export default function POSPage() {
  const [state, setState] = useState<POSState>({
    currentCustomer: null,
    recentTransactions: [],
    isLoading: false,
    error: null
  });

  const [customerIdInput, setCustomerIdInput] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [note, setNote] = useState('');
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Load customer when ID is entered
  const loadCustomer = async (customerId: string) => {
    if (!customerId || customerId.length !== 4) return;
    
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch(`/api/customers/${customerId}`);
      if (!response.ok) {
        throw new Error('Customer not found');
      }
      
      const customer = await response.json();
      const transactionsResponse = await fetch(`/api/customers/${customerId}/transactions`);
      const transactions = await transactionsResponse.json();
      
      setState(prev => ({
        ...prev,
        currentCustomer: customer,
        recentTransactions: transactions,
        isLoading: false
      }));
      
      // Focus on barcode input after loading customer
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load customer',
        isLoading: false
      }));
    }
  };

  // Handle barcode scan
  const processPurchase = async (barcode: string) => {
    if (!state.currentCustomer || !barcode) return;
    
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch('/api/transactions/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: state.currentCustomer.customer_id,
          barcode: barcode
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Purchase failed');
      }
      
      // Reload customer data to get updated balance and transactions
      await loadCustomer(state.currentCustomer.customer_id);
      setBarcodeInput('');
      
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Purchase failed',
        isLoading: false
      }));
    }
  };

  // Handle deposit
  const processDeposit = async () => {
    if (!state.currentCustomer || !depositAmount) return;
    
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      setState(prev => ({ ...prev, error: 'Invalid deposit amount' }));
      return;
    }
    
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch('/api/transactions/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: state.currentCustomer.customer_id,
          amount: amount,
          note: note || undefined
        }),
      });
      
      if (!response.ok) {
        throw new Error('Deposit failed');
      }
      
      // Reload customer data
      await loadCustomer(state.currentCustomer.customer_id);
      setDepositAmount('');
      setNote('');
      
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Deposit failed',
        isLoading: false
      }));
    }
  };

  // Handle adjustment
  const processAdjustment = async () => {
    if (!state.currentCustomer || !adjustmentAmount) return;
    
    const amount = parseFloat(adjustmentAmount);
    if (isNaN(amount)) {
      setState(prev => ({ ...prev, error: 'Invalid adjustment amount' }));
      return;
    }
    
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch('/api/transactions/adjustment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: state.currentCustomer.customer_id,
          amount: amount,
          note: note || undefined
        }),
      });
      
      if (!response.ok) {
        throw new Error('Adjustment failed');
      }
      
      // Reload customer data
      await loadCustomer(state.currentCustomer.customer_id);
      setAdjustmentAmount('');
      setNote('');
      setShowAdjustmentForm(false);
      
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Adjustment failed',
        isLoading: false
      }));
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-center text-camp-700 mb-4">
            Camp Canteen POS
          </h1>
          
          {/* Customer ID Input */}
          <div className="flex justify-center space-x-4">
            <input
              type="text"
              placeholder="Enter 4-digit Customer ID"
              value={customerIdInput}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCustomerIdInput(value);
                if (value.length === 4) {
                  loadCustomer(value);
                }
              }}
              className="pos-input text-center text-xl w-64"
              maxLength={4}
            />
            <button
              onClick={() => loadCustomer(customerIdInput)}
              disabled={customerIdInput.length !== 4 || state.isLoading}
              className="pos-button disabled:opacity-50"
            >
              Find Customer
            </button>
          </div>
        </div>

        {/* Error Display */}
        {state.error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {state.error}
          </div>
        )}

        {/* Customer Info and Transaction Log */}
        {state.currentCustomer && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Info */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Customer Information</h2>
              <div className="space-y-2">
                <p><span className="font-medium">ID:</span> #{state.currentCustomer.customer_id}</p>
                {state.currentCustomer.name && (
                  <p><span className="font-medium">Name:</span> {state.currentCustomer.name}</p>
                )}
                <p className="text-2xl font-bold text-camp-600">
                  Balance: {formatCurrency(state.currentCustomer.balance)}
                </p>
              </div>

              {/* Barcode Scanner */}
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Scan Item Barcode:
                </label>
                <input
                  ref={barcodeInputRef}
                  type="text"
                  placeholder="Barcode will appear here"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && barcodeInput) {
                      processPurchase(barcodeInput);
                    }
                  }}
                  className="pos-input w-full"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Each scan instantly deducts price and logs transaction
                </p>
              </div>

              {/* Deposit/Adjustment Actions */}
              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Deposit Funds:
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="pos-input flex-1"
                    />
                    <button
                      onClick={processDeposit}
                      disabled={!depositAmount || state.isLoading}
                      className="pos-button disabled:opacity-50"
                    >
                      Deposit
                    </button>
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => setShowAdjustmentForm(!showAdjustmentForm)}
                    className="bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-2 px-4 rounded transition-colors"
                  >
                    Adjust Balance
                  </button>
                </div>

                {showAdjustmentForm && (
                  <div className="border border-gray-300 rounded p-4 bg-gray-50">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Adjustment Amount: (+ for add, - for subtract)
                    </label>
                    <div className="flex space-x-2 mb-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="+10.00 or -5.00"
                        value={adjustmentAmount}
                        onChange={(e) => setAdjustmentAmount(e.target.value)}
                        className="pos-input flex-1"
                      />
                      <button
                        onClick={processAdjustment}
                        disabled={!adjustmentAmount || state.isLoading}
                        className="pos-button disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                )}

                {(depositAmount || adjustmentAmount) && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Optional Note:
                    </label>
                    <input
                      type="text"
                      placeholder="Reason for transaction"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="pos-input w-full"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Transaction Log */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Recent Transactions</h2>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2">Time</th>
                      <th className="text-left py-2">Type</th>
                      <th className="text-left py-2">Item/Note</th>
                      <th className="text-right py-2">Amount</th>
                      <th className="text-right py-2">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.recentTransactions.map((transaction) => (
                      <tr key={transaction.id} className="transaction-row">
                        <td className="py-2">{formatTime(transaction.timestamp)}</td>
                        <td className="py-2 capitalize">{transaction.type}</td>
                        <td className="py-2">
                          {transaction.type === 'purchase'
                            ? transaction.product_name || 'Unknown Item'
                            : transaction.note || '-'}
                        </td>
                        <td className={`py-2 text-right font-medium ${
                          transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {transaction.amount >= 0 ? '+' : ''}{formatCurrency(transaction.amount)}
                        </td>
                        <td className="py-2 text-right font-medium">
                          {formatCurrency(transaction.balance_after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {state.recentTransactions.length === 0 && (
                  <p className="text-gray-500 text-center py-4">No transactions yet</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        {!state.currentCustomer && (
          <div className="bg-white rounded-lg shadow-lg p-6 text-center">
            <h2 className="text-xl font-semibold mb-4">Instructions</h2>
            <ol className="text-left max-w-md mx-auto space-y-2">
              <li>1. Enter customer&apos;s 4-digit ID</li>
              <li>2. Scan barcodes for instant purchases</li>
              <li>3. Use deposit/adjustment forms as needed</li>
              <li>4. All transactions are logged automatically</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}