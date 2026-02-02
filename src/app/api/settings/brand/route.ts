import { NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const database = DatabaseManager.getInstance();
    const settings = await database.getAppSettings();
    return NextResponse.json({
      brandName: settings.brandName,
    });
  } catch (error) {
    console.error('Error loading brand settings:', error);
    return NextResponse.json({ brandName: null }, { status: 200 });
  }
}
