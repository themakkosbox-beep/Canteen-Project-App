import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { requireAdminAccess } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const database = DatabaseManager.getInstance();
    const status = await database.getBackupStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Error loading backup status:', error);
    return NextResponse.json({ error: 'Failed to load backup status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const database = DatabaseManager.getInstance();
    const result = await database.createBackup();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating backup:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create backup' },
      { status: 500 }
    );
  }
}
