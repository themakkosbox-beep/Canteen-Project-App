import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import type { ProductOptionSelection } from '@/types/database';
import { serializeProduct } from '../../products/serializer';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { transactionId: string } }
) {
  try {
    const { transactionId } = params;

    if (!transactionId || typeof transactionId !== 'string' || transactionId.trim().length === 0) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const result = await database.deleteTransaction(transactionId.trim());

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete transaction' },
      { status: 400 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { transactionId: string } }
) {
  try {
    const { transactionId } = params;
    const body = await request.json();

    const customerId = typeof body?.customerId === 'string' ? body.customerId.trim() : '';
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    const note = typeof body?.note === 'string' ? body.note : undefined;
    const selectedOptions = Array.isArray(body?.selectedOptions)
      ? (body.selectedOptions as ProductOptionSelection[])
      : undefined;

    if (!transactionId || transactionId.trim().length === 0) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    if (!/^[0-9]{4}$/.test(customerId)) {
      return NextResponse.json(
        { error: 'Customer ID must be exactly 4 digits' },
        { status: 400 }
      );
    }

    if (!productId) {
      return NextResponse.json(
        { error: 'Product ID is required' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const result = await database.updateExistingPurchaseTransaction(transactionId, {
      customerId,
      productId,
      note,
      selectedOptions,
    });

    return NextResponse.json({
      success: true,
      transaction: result.transaction,
      product: serializeProduct(result.product),
      optionSelections: result.optionSelections,
      chargedAmount: result.chargedAmount,
      voidedTransaction: result.voidedTransaction,
      balanceAfter: result.balanceAfter,
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update transaction' },
      { status: 400 }
    );
  }
}
