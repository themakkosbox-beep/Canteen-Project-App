import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { serializeProduct } from '../../products/route';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const database = DatabaseManager.getInstance();
    const slots = await database.getQuickKeySlots();

    return NextResponse.json({
      slots: slots.map((slot) => ({
        index: slot.index,
        productId: slot.productId,
        product: slot.product ? serializeProduct(slot.product) : null,
      })),
    });
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
    const body = await request.json();
    const productIds: unknown = body?.productIds;

    if (!Array.isArray(productIds)) {
      return NextResponse.json(
        { error: 'productIds array is required' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    await database.setQuickKeyProductIds(productIds as Array<string | null>);

    const slots = await database.getQuickKeySlots();

    return NextResponse.json({
      slots: slots.map((slot) => ({
        index: slot.index,
        productId: slot.productId,
        product: slot.product ? serializeProduct(slot.product) : null,
      })),
    });
  } catch (error) {
    console.error('Error saving quick key settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save quick keys' },
      { status: 400 }
    );
  }
}
