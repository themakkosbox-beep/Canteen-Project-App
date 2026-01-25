import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const customerId = typeof body?.customerId === 'string' ? body.customerId.trim() : '';
    const amount = Number(body?.amount);
    const note = body?.note;

    if (!/^\d{4}$/.test(customerId)) {
      return NextResponse.json(
        { error: 'Customer ID must be exactly 4 digits' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Deposit amount must be a positive number' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const result = await database.processDeposit(customerId, amount, note);
    
    return NextResponse.json({
      success: true,
      transaction: result
    });
    
  } catch (error) {
    console.error('Error processing deposit:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Deposit failed' },
      { status: 400 }
    );
  }
}
