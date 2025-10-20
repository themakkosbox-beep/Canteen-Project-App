import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerId, barcode } = body;
    
    if (!customerId || !barcode) {
      return NextResponse.json(
        { error: 'Customer ID and barcode are required' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const result = await database.processPurchase(customerId, barcode);
    
    return NextResponse.json({
      success: true,
      transaction: result
    });
    
  } catch (error) {
    console.error('Error processing purchase:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Purchase failed' },
      { status: 400 }
    );
  }
}