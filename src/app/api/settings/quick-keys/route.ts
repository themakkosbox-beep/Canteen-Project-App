import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { serializeProduct } from '../../products/serializer';
import { requireAdminAccess } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const preflightHeaders = new Headers({
  Allow: 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: preflightHeaders,
  });
}

export async function GET(request: NextRequest) {
  try {
    const database = DatabaseManager.getInstance();
    const shiftId = request.nextUrl.searchParams.get('shiftId');
    const slots = await database.getQuickKeySlots(shiftId);

    return NextResponse.json(
      {
        slots: slots.map((slot) => ({
          index: slot.index,
          productId: slot.productId,
          product: slot.product ? serializeProduct(slot.product) : null,
        })),
      },
      { headers: preflightHeaders }
    );
  } catch (error) {
    console.error('Error loading quick key settings:', error);
    return NextResponse.json(
      { error: 'Failed to load quick key settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const body = await request.json();
    const productIds: unknown = body?.productIds;
    const shiftId = typeof body?.shiftId === 'string' ? body.shiftId : undefined;

    if (!Array.isArray(productIds)) {
      return NextResponse.json(
        { error: 'productIds array is required' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    await database.setQuickKeyProductIds(productIds as Array<string | null>, shiftId);

    const slots = await database.getQuickKeySlots(shiftId);

    return NextResponse.json(
      {
        slots: slots.map((slot) => ({
          index: slot.index,
          productId: slot.productId,
          product: slot.product ? serializeProduct(slot.product) : null,
        })),
      },
      { headers: preflightHeaders }
    );
  } catch (error) {
    console.error('Error saving quick key settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save quick keys' },
      { status: 400 }
    );
  }
}
