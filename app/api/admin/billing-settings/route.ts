import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { currentCleaningBillingTerms } from "@/lib/cleaningBillingSettings";
import { parseCleaningBillingTerms } from "@/lib/cleaningBillingTerms";

export async function GET(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  try {
    return NextResponse.json(await currentCleaningBillingTerms(context.admin), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Settings could not be loaded." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const context = await adminApi(request);
  if (context instanceof NextResponse) return context;
  try {
    const body = await request.json();
    const terms = parseCleaningBillingTerms(body);
    const latest = await currentCleaningBillingTerms(context.admin);
    if (terms.version !== latest.version)
      return NextResponse.json(
        {
          error:
            "Another administrator changed these settings. Reload and check the latest prices.",
        },
        { status: 409 },
      );
    const { version: _oldVersion, ...prices } = terms;
    const { data, error } = await context.admin
      .from("cleaning_billing_settings")
      .insert({ terms: prices, created_by: context.user.id })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ ...prices, version: String(data.id) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Settings could not be saved.",
      },
      { status: 400 },
    );
  }
}
