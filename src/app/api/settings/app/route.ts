import { NextRequest, NextResponse } from 'next/server';
import DatabaseManager from '@/lib/database';

export const runtime = 'nodejs';

const buildError = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function GET() {
  try {
    const database = DatabaseManager.getInstance();
    const settings = await database.getAppSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Error loading app settings:', error);
    return buildError('Failed to load app settings', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const brandName =
      body?.brandName === null ? '' : typeof body?.brandName === 'string' ? body.brandName : undefined;
    const newAdminCode = typeof body?.adminCode === 'string' ? body.adminCode : undefined;
    const clearAdminCode = Boolean(body?.clearAdminCode);
    const currentAdminCode = typeof body?.currentAdminCode === 'string' ? body.currentAdminCode : undefined;
    let globalDiscountPercent =
      body?.globalDiscountPercent === null
        ? null
        : typeof body?.globalDiscountPercent === 'number'
        ? body.globalDiscountPercent
        : typeof body?.globalDiscountPercent === 'string'
        ? Number.parseFloat(body.globalDiscountPercent)
        : undefined;
    let globalDiscountFlat =
      body?.globalDiscountFlat === null
        ? null
        : typeof body?.globalDiscountFlat === 'number'
        ? body.globalDiscountFlat
        : typeof body?.globalDiscountFlat === 'string'
        ? Number.parseFloat(body.globalDiscountFlat)
        : undefined;

    if (typeof globalDiscountPercent === 'number' && !Number.isFinite(globalDiscountPercent)) {
      globalDiscountPercent = undefined;
    }

    if (typeof globalDiscountFlat === 'number' && !Number.isFinite(globalDiscountFlat)) {
      globalDiscountFlat = undefined;
    }

    const database = DatabaseManager.getInstance();
    const existingSettings = await database.getAppSettings();

    if (existingSettings.adminCodeSet) {
      const candidate = typeof currentAdminCode === 'string' ? currentAdminCode : '';
      const verified = await database.verifyAdminAccessCode(candidate);
      if (!verified) {
        return buildError('Current admin code is incorrect', 401);
      }
    }

    if (newAdminCode && newAdminCode.trim().length < 4) {
      return buildError('Admin code must be at least 4 characters');
    }

    const nextSettings = await database.updateAppSettings({
      brandName,
      adminCode: newAdminCode,
      clearAdminCode,
      globalDiscountPercent,
      globalDiscountFlat,
    });

    return NextResponse.json(nextSettings);
  } catch (error) {
    console.error('Error updating app settings:', error);
    return buildError(
      error instanceof Error ? error.message : 'Failed to update app settings',
      400
    );
  }
}
