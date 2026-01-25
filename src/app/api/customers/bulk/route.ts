import { NextRequest, NextResponse } from "next/server";
import DatabaseManager, { BulkCustomerInput } from "@/lib/database";
import { requireAdminAccess } from "@/lib/admin-auth";

interface BulkCustomerPayload {
  customers?: unknown;
}

interface BulkFailure<T> {
  input: T;
  error: string;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminAccess(request);
    if (auth) {
      return auth;
    }

    const body = (await request.json()) as BulkCustomerPayload;
    const rawEntries = Array.isArray(body.customers) ? body.customers : [];

    if (!Array.isArray(body.customers)) {
      return NextResponse.json(
        { error: "Request body must include a customers array." },
        { status: 400 }
      );
    }

    const validEntries: BulkCustomerInput[] = [];
    const invalidEntries: BulkFailure<unknown>[] = [];

    for (const entry of rawEntries) {
      if (typeof entry !== "object" || entry === null) {
        invalidEntries.push({ input: entry, error: "Entry must be an object." });
        continue;
      }

      const customerIdRaw = Reflect.get(entry, "customerId");
      if (typeof customerIdRaw !== "string") {
        invalidEntries.push({ input: entry, error: "customerId is required." });
        continue;
      }

      const customerId = customerIdRaw.trim();
      if (!/^\d{4}$/.test(customerId)) {
        invalidEntries.push({ input: entry, error: "customerId must be exactly 4 digits." });
        continue;
      }

      const nameRaw = Reflect.get(entry, "name");
      if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
        invalidEntries.push({ input: entry, error: "name is required." });
        continue;
      }

      const name = nameRaw.trim();

      const balanceRaw = Reflect.get(entry, "initialBalance");
      let initialBalance: number | undefined;
      if (balanceRaw !== undefined && balanceRaw !== null && `${balanceRaw}`.length > 0) {
        const parsed = typeof balanceRaw === "number" ? balanceRaw : Number.parseFloat(String(balanceRaw));
        if (!Number.isFinite(parsed) || parsed < 0) {
          invalidEntries.push({ input: entry, error: "initialBalance must be zero or a positive number." });
          continue;
        }
        initialBalance = parsed;
      }

  validEntries.push({ customerId, name, initialBalance });
    }

    if (validEntries.length === 0) {
      return NextResponse.json(
        {
          created: [],
          failed: invalidEntries,
          message: "No valid customer entries supplied.",
        },
        { status: 400 }
      );
    }

    const db = DatabaseManager.getInstance();
    const result = await db.bulkCreateCustomers(validEntries);

    const failed = [...result.failed, ...invalidEntries];

    return NextResponse.json({
      created: result.created,
      failed,
      createdCount: result.created.length,
      failedCount: failed.length,
    });
  } catch (error) {
    console.error("Bulk customer upload failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to process bulk customer upload.",
      },
      { status: 500 }
    );
  }
}
