import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';
import { requireAdminAccess } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Backup file upload required' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const upload = formData.get('file');
    if (!upload || typeof upload === 'string') {
      return NextResponse.json(
        { error: 'Backup file is missing' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await upload.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json(
        { error: 'Backup file is empty' },
        { status: 400 }
      );
    }

    const tempPath = path.join(
      os.tmpdir(),
      `canteen-restore-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
    );
    fs.writeFileSync(tempPath, buffer);

    try {
      const database = DatabaseManager.getInstance();
      await database.restoreBackupFromPath(tempPath);
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch (error) {
        console.warn('Failed to remove temporary restore file', error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error restoring backup:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to restore backup' },
      { status: 500 }
    );
  }
}
