import { NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import type { TransactionExportRow, TransactionOptionSelection } from '@/types/database';

export const runtime = 'nodejs';

const CSV_HEADER = [
  'Timestamp',
  'Transaction ID',
  'Customer ID',
  'Customer Name',
  'Type',
  'Product ID',
  'Product Name',
  'Product Price',
  'Amount',
  'Balance After',
  'Note',
  'Voided',
  'Voided Note',
  'Staff ID',
  'Options',
];

const escapeCsvValue = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) {
    return '""';
  }
  const normalized = typeof value === 'string' ? value : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
};

const describeOptions = (options?: TransactionOptionSelection[] | null): string => {
  if (!Array.isArray(options) || options.length === 0) {
    return '';
  }

  return options
    .map((group) => {
      const choiceLabels = group.choices.map((choice) => choice.label).join(', ');
      const deltaLabel = group.delta ? ` (${group.delta > 0 ? '+' : '-'}${Math.abs(group.delta).toFixed(2)})` : '';
      return `${group.groupName}: ${choiceLabels}${deltaLabel}`;
    })
    .join(' | ');
};

const toCurrency = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }
  return (Math.round(value * 100) / 100).toFixed(2);
};

const buildCsv = (rows: TransactionExportRow[]): string => {
  const lines = [CSV_HEADER.map((value) => escapeCsvValue(value)).join(',')];

  rows.forEach((row) => {
    const record = [
      row.timestamp,
      row.transaction_id,
      row.customer_id,
      row.customer_name ?? '',
      row.type,
      row.product_id ?? '',
      row.product_name ?? '',
      toCurrency(row.product_price ?? null),
      toCurrency(row.amount),
      toCurrency(row.balance_after),
      row.note ?? '',
      row.voided ? 'true' : 'false',
      row.void_note ?? '',
      row.staff_id ?? '',
      describeOptions(row.options),
    ];

    lines.push(record.map(escapeCsvValue).join(','));
  });

  return lines.join('\r\n');
};

export async function GET() {
  try {
    const database = DatabaseManager.getInstance();
    const transactions = await database.listAllTransactions();
    const csv = buildCsv(transactions);
    const filename = `camp-canteen-transactions-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error exporting transactions:', error);
    return NextResponse.json(
      { error: 'Failed to export transactions' },
      { status: 500 }
    );
  }
}
