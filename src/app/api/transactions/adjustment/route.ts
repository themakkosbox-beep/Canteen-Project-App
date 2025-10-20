import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerId, amount, note } = body;
    
    if (!customerId || !amount || amount === 0) {
      return NextResponse.json(
        { error: 'Customer ID and non-zero amount are required' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const result = await database.processAdjustment(customerId, amount, note);
    
    return NextResponse.json({
      success: true,
      transaction: result
    });
    
  } catch (error) {
    console.error('Error processing adjustment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Adjustment failed' },
      { status: 400 }
    );
  }
}