import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { serializeProduct } from './serializer';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const search = searchParams.get('search') ?? undefined;
    const category = searchParams.get('category') ?? undefined;

    const database = DatabaseManager.getInstance();
    const products = await database.listProducts(includeInactive, limit ?? 100, search, category);

    return NextResponse.json(products.map(serializeProduct));
  } catch (error) {
    console.error('Error listing products:', error);
    return NextResponse.json(
      { error: 'Failed to load products' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { productId, name, price, barcode, category, active, options } = await request.json();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Product name is required' },
        { status: 400 }
      );
    }

    const normalizedPrice = Number(price);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      return NextResponse.json(
        { error: 'Product price must be a positive number' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const product = await database.createProduct({
      productId: typeof productId === 'string' && productId.trim().length > 0 ? productId.trim() : undefined,
      name,
      price: normalizedPrice,
      barcode: typeof barcode === 'string' && barcode.trim().length > 0 ? barcode.trim() : undefined,
      category: typeof category === 'string' && category.trim().length > 0 ? category.trim() : undefined,
      active: active === undefined ? true : Boolean(active),
      options: Array.isArray(options) ? options : undefined,
    });

    return NextResponse.json(serializeProduct(product), { status: 201 });
  } catch (error) {
    console.error('Error creating product:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create product' },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const productIds: unknown = body?.productIds ?? body?.ids;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json(
        { error: 'productIds must be a non-empty array' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const result = await database.deleteProducts(productIds as string[]);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error deleting products:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete products' },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const productIds: unknown = body?.productIds ?? body?.ids;
    const active = body?.active;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json(
        { error: 'productIds must be a non-empty array' },
        { status: 400 }
      );
    }

    if (typeof active !== 'boolean') {
      return NextResponse.json(
        { error: 'active flag must be provided as boolean' },
        { status: 400 }
      );
    }

    const database = DatabaseManager.getInstance();
    const result = await database.updateProductsActiveStatus(productIds as string[], active);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating products:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update products' },
      { status: 400 }
    );
  }
}

