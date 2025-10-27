import { NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const database = DatabaseManager.getInstance();
    const transactions = await database.listAllTransactions();
    return NextResponse.json(transactions);
  } catch (error) {
    console.error('Error exporting transactions:', error);
    return NextResponse.json(
      { error: 'Failed to export transactions' },
      { status: 500 }
    );
  }
}
