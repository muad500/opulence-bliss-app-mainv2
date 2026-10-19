import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deliverAccountSecurityAlerts } from "@/lib/accountSecurityDelivery";
import { deliverChatMessageEmails } from "@/lib/chatMessageDelivery";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const security = await deliverAccountSecurityAlerts(admin);
    const messages = await deliverChatMessageEmails(admin);
    return NextResponse.json(
      { ...security, messages },
      {
        status: messages.failed ? 503 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Security alert delivery needs attention" },
      { status: 503 },
    );
  }
}
