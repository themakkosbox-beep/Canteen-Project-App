import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

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
