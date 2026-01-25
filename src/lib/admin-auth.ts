import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const ADMIN_CODE_HEADER = 'x-admin-code';

export const requireAdminAccess = async (
  request: NextRequest
): Promise<NextResponse | null> => {
  const database = DatabaseManager.getInstance();
  const settings = await database.getAppSettings();

  if (!settings.adminCodeSet) {
    return null;
  }

  const candidate = request.headers.get(ADMIN_CODE_HEADER) ?? '';
  const verified = await database.verifyAdminAccessCode(candidate);
  if (!verified) {
    return NextResponse.json(
      { error: 'Admin code required', adminCodeRequired: true },
      { status: 401 }
    );
  }

  return null;
};
