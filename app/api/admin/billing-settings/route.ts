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
    if (
      latest.cancellationBasis === "booking_total" &&
      terms.cancellationBasis !== "booking_total"
    )
      throw new Error(
        "The final published cancellation policy must remain active for new bookings.",
      );
    if (
      terms.cancellationBasis !== undefined &&
      latest.cancellationBasis !== terms.cancellationBasis
    ) {
      const { data: policy, error } = await context.admin
        .from("legal_documents")
        .select("version,content_html")
        .eq("slug", "cancellation-refund")
        .eq("published", true)
        .maybeSingle();
      if (
        error ||
        !policy?.content_html ||
        body.confirmPolicyPublished !== true
      )
        throw new Error(
          "Publish the matching cancellation policy and confirm it before switching on the new rules.",
        );
    }
    if (
      !terms.cancellationBasis &&
      !Object.entries({
        full: 100,
        three_quarter: 75,
        half: 50,
        none: 0,
      }).every(
        ([key, value]) =>
          terms.cancellationRefundPercent[
            key as keyof typeof terms.cancellationRefundPercent
          ] === value,
      )
    )
      throw new Error(
        "The currently published cancellation bands must remain 0/25/50/100%.",
      );
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
