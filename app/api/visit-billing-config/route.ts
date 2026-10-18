import { createClient } from "@supabase/supabase-js";
import { currentCleaningBillingTerms } from "@/lib/cleaningBillingSettings";
import { customerBillingTerms } from "@/lib/cleaningBillingTerms";
import { NextResponse } from "next/server";
import { bookingSmsConfig } from "@/lib/bookingSms";
import { visitBillingEnabled } from "@/lib/visitBillingPolicy";
export async function GET() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  let pricing;
  try {
    pricing = customerBillingTerms(await currentCleaningBillingTerms(admin));
  } catch {
    return NextResponse.json(
      { error: "Booking prices are being updated." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      pricing,
      perVisitBilling: visitBillingEnabled(),
      smsAvailable: bookingSmsConfig(process.env) !== null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
