import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { createVisitBilling } from "@/lib/visitBillingServer";

export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (
    !secret ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
  ) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const result = await createVisitBilling(admin, stripe).tick(20);
    return NextResponse.json(result);
  } catch {
    console.error(
      "Visit payment scheduler needs attention; no secret details logged.",
    );
    return NextResponse.json(
      { error: "Recovery will retry. Check the visit operation ledger." },
      { status: 500 },
    );
  }
}
