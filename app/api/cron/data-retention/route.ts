import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { retentionCronSecret, runDataRetention } from "@/lib/dataRetention";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = retentionCronSecret(process.env);
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    !secret ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const result = await runDataRetention(
      client,
      request.nextUrl.searchParams.get("dry") === "1",
    );
    return NextResponse.json(result, {
      status: result.filesFailed || Number(result.failed) > 0 ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Data retention needs attention. Check the admin log." },
      { status: 503 },
    );
  }
}
