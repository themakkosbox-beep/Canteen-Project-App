import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { serializeProduct } from '../serializer';
import { requireAdminAccess } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const database = DatabaseManager.getInstance();
    const product = await database.getProductById(productId, true);

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json(serializeProduct(product));
  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const { productId } = await params;
    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { name, price, barcode, category, active, options, discountPercent, discountFlat } = body;

    const discountPercentValue =
      discountPercent === undefined
        ? undefined
        : discountPercent === null || discountPercent === ''
        ? null
        : Number(discountPercent);
    if (
      discountPercentValue !== undefined &&
      discountPercentValue !== null &&
      (!Number.isFinite(discountPercentValue) || discountPercentValue < 0 || discountPercentValue > 100)
    ) {
      return NextResponse.json(
        { error: 'discountPercent must be between 0 and 100' },
        { status: 400 }
      );
    }

    const discountFlatValue =
      discountFlat === undefined
        ? undefined
        : discountFlat === null || discountFlat === ''
        ? null
        : Number(discountFlat);
    if (
      discountFlatValue !== undefined &&
      discountFlatValue !== null &&
      (!Number.isFinite(discountFlatValue) || discountFlatValue < 0)
    ) {
      return NextResponse.json(
        { error: 'discountFlat must be zero or a positive number' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const product = await database.updateProduct(productId, {
      name,
      price: price !== undefined ? Number(price) : undefined,
      barcode: barcode === null ? null : barcode,
      category: category === null ? null : category,
      active: active === undefined ? undefined : Boolean(active),
      options: Array.isArray(options) ? options : options === null ? null : undefined,
      discountPercent: discountPercentValue,
      discountFlat: discountFlatValue,
    });

    return NextResponse.json(serializeProduct(product));
  } catch (error) {
    console.error('Error updating product:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update product' },
      { status: 400 }
    );
  }
}
