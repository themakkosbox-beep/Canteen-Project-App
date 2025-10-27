import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  try {
    const { customerId } = params;
    
    if (!customerId || customerId.length !== 4) {
      return NextResponse.json(
        { error: 'Customer ID must be 4 digits' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const transactions = await database.getCustomerTransactions(customerId, 20);

    return NextResponse.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}