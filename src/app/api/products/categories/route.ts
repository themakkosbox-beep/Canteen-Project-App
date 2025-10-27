import { NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const database = DatabaseManager.getInstance();
    const categories = await database.listProductCategories();
    return NextResponse.json(categories);
  } catch (error) {
    console.error('Error listing product categories:', error);
    return NextResponse.json(
      { error: 'Failed to load product categories' },
      { status: 500 }
    );
  }
}
