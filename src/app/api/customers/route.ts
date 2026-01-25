import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { requireAdminAccess } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const search = request.nextUrl.searchParams.get('search') ?? undefined;
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offsetParam = request.nextUrl.searchParams.get('offset');
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

    const database = DatabaseManager.getInstance();
    const customers = await database.listCustomers(search, limit ?? 50, offset);

    return NextResponse.json(customers);
  } catch (error) {
    console.error('Error listing customers:', error);
    return NextResponse.json(
      { error: 'Failed to load customers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const { customerId, name, initialBalance } = await request.json();

    if (!customerId || typeof customerId !== 'string' || !/^\d{4}$/.test(customerId)) {
      return NextResponse.json(
        { error: 'Customer ID must be a 4-digit string' },
        { status: 400 }
      );
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }

    const normalizedName = name.trim();
    const balanceValue =
      initialBalance === undefined || initialBalance === null
        ? 0
        : Number(initialBalance);

    if (!Number.isFinite(balanceValue) || balanceValue < 0) {
      return NextResponse.json(
        { error: 'Initial balance must be zero or a positive number' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const customer = await database.createCustomer(
      customerId,
      normalizedName,
      balanceValue
    );

    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create customer' },
      { status: 400 }
    );
  }
}
