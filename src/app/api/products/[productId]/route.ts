import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { serializeProduct } from '../serializer';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  try {
    const { productId } = params;
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
  { params }: { params: { productId: string } }
) {
  try {
    const { productId } = params;
    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { name, price, barcode, category, active, options } = body;

    const database = DatabaseManager.getInstance();
    const product = await database.updateProduct(productId, {
      name,
      price: price !== undefined ? Number(price) : undefined,
      barcode: barcode === null ? null : barcode,
      category: category === null ? null : category,
      active: active === undefined ? undefined : Boolean(active),
      options: Array.isArray(options) ? options : options === null ? null : undefined,
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
