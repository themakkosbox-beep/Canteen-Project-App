import { NextResponse } from "next/server";
import DatabaseManager, { BulkProductInput } from "@/lib/database";

interface BulkProductPayload {
  products?: unknown;
}

interface BulkFailure<T> {
  input: T;
  error: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BulkProductPayload;
    const rawEntries = Array.isArray(body.products) ? body.products : [];

    if (!Array.isArray(body.products)) {
      return NextResponse.json(
        { error: "Request body must include a products array." },
        { status: 400 }
      );
    }

    const validEntries: BulkProductInput[] = [];
    const invalidEntries: BulkFailure<unknown>[] = [];

    for (const entry of rawEntries) {
      if (typeof entry !== "object" || entry === null) {
        invalidEntries.push({ input: entry, error: "Entry must be an object." });
        continue;
      }

      const nameRaw = Reflect.get(entry, "name");
      if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
        invalidEntries.push({ input: entry, error: "name is required." });
        continue;
      }
      const name = nameRaw.trim();

      const priceRaw = Reflect.get(entry, "price");
      const parsedPrice = typeof priceRaw === "number" ? priceRaw : Number.parseFloat(String(priceRaw));
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        invalidEntries.push({ input: entry, error: "price must be a positive number." });
        continue;
      }

      const productIdRaw = Reflect.get(entry, "productId");
      const productId = typeof productIdRaw === "string" && productIdRaw.trim().length > 0 ? productIdRaw.trim() : undefined;

      const barcodeRaw = Reflect.get(entry, "barcode");
      const barcode = typeof barcodeRaw === "string" && barcodeRaw.trim().length > 0 ? barcodeRaw.trim() : undefined;

      const categoryRaw = Reflect.get(entry, "category");
      const category = typeof categoryRaw === "string" && categoryRaw.trim().length > 0 ? categoryRaw.trim() : undefined;

      const activeRaw = Reflect.get(entry, "active");
      const active = typeof activeRaw === "boolean" ? activeRaw : undefined;

      validEntries.push({ productId, name, price: parsedPrice, barcode, category, active });
    }

    if (validEntries.length === 0) {
      return NextResponse.json(
        {
          created: [],
          failed: invalidEntries,
          message: "No valid product entries supplied.",
        },
        { status: 400 }
      );
    }

    const db = DatabaseManager.getInstance();
    const result = await db.bulkCreateProducts(validEntries);

    const failed = [...result.failed, ...invalidEntries];

    return NextResponse.json({
      created: result.created,
      failed,
      createdCount: result.created.length,
      failedCount: failed.length,
    });
  } catch (error) {
    console.error("Bulk product upload failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to process bulk product upload.",
      },
      { status: 500 }
    );
  }
}
