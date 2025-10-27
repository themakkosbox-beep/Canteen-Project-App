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
    const customer = await database.getCustomerById(customerId);
    
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error fetching customer:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  try {
    const { customerId } = params;
    const body = await request.json();
    const { name } = body;

    if (!customerId || customerId.length !== 4) {
      return NextResponse.json(
        { error: 'Customer ID must be 4 digits' },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const customer = await database.updateCustomer(customerId, {
      name,
    });

    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error updating customer:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update customer' },
      { status: 400 }
    );
  }
}