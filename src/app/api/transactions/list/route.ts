import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const database = DatabaseManager.getInstance();
    const limitParam = request.nextUrl.searchParams.get('limit');
    let limit = Number.parseInt(limitParam ?? '50', 10);

    if (!Number.isFinite(limit) || limit <= 0) {
      limit = 50;
    }

    if (limit > 500) {
      limit = 500;
    }

    const transactions = await database.listAllTransactions();
    const payload = transactions.slice(0, limit);

    return NextResponse.json({
      transactions: payload,
      totalCount: transactions.length,
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
