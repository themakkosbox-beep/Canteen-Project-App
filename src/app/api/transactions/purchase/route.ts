import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import type { ProductOptionSelection } from '@/types/database';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
  const body = await request.json();
  const { customerId, barcode, productId, note, selectedOptions } = body;

    const normalizedCustomerId = typeof customerId === 'string' ? customerId.trim() : '';
    if (!/^\d{4}$/.test(normalizedCustomerId)) {
      return NextResponse.json(
        { error: 'Customer ID must be exactly 4 digits' },
        { status: 400 }
      );
    }

    if (
      (!barcode || typeof barcode !== 'string' || barcode.trim().length === 0) &&
      (!productId || typeof productId !== 'string' || productId.trim().length === 0)
    ) {
      return NextResponse.json(
        { error: 'Either barcode or productId must be provided' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const normalizedSelectedOptions = Array.isArray(selectedOptions)
      ? (selectedOptions as ProductOptionSelection[])
      : undefined;

    const result = await database.processPurchase(normalizedCustomerId, {
      barcode: typeof barcode === 'string' && barcode.trim().length > 0 ? barcode.trim() : undefined,
      productId:
        typeof productId === 'string' && productId.trim().length > 0 ? productId.trim() : undefined,
      note: typeof note === 'string' && note.trim().length > 0 ? note.trim() : undefined,
      selectedOptions: normalizedSelectedOptions,
    });
    
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
