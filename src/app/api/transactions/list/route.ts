import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const database = DatabaseManager.getInstance();
    const limitParam = request.nextUrl.searchParams.get('limit');
    let limit = Number.parseInt(limitParam ?? '50', 10);
    const offsetParam = request.nextUrl.searchParams.get('offset');
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

    if (!Number.isFinite(limit) || limit <= 0) {
      limit = 50;
    }

    if (limit > 500) {
      limit = 500;
    }

    const [transactions, totalCount] = await Promise.all([
      database.listAllTransactions(limit, offset),
      database.getTransactionCount(),
    ]);
    const payload = transactions;

    return NextResponse.json({
      transactions: payload,
      totalCount,
    });
  } catch (error) {
    console.error('Error listing transactions:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list transactions',
      },
      { status: 400 }
    );
  }
}
