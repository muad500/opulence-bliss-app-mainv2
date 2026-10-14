import { NextResponse } from "next/server";
import { visitBillingEnabled } from "@/lib/visitBillingPolicy";
export function GET() {
  return NextResponse.json(
    { perVisitBilling: visitBillingEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
