import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unauthorizedResponse = () =>
  NextResponse.json({ error: 'Admin code required', adminCodeRequired: true }, { status: 401 });

export async function GET(request: NextRequest) {
  try {
    const database = DatabaseManager.getInstance();
    const settings = await database.getAppSettings();
    const adminCode = request.headers.get('x-admin-code') ?? '';

    if (settings.adminCodeSet) {
      const verified = await database.verifyAdminAccessCode(adminCode);
      if (!verified) {
        return unauthorizedResponse();
      }
    }

    const summary = await database.getTransactionStatsSummary();
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error loading transaction stats:', error);
    return NextResponse.json({ error: 'Failed to load transaction stats' }, { status: 500 });
  }
}
