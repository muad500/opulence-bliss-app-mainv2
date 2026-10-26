import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { validDocumentDate } from "@/lib/providerVerification";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const provider = request.nextUrl.searchParams.get("provider") ?? "";
  if (!UUID.test(provider)) return failure("Choose a professional.");
  const [history, clock] = await Promise.all([
    ctx.admin
      .from("cleaner_rate_retention_events")
      .select(
        "id,action,hourly_pence,notice_received_on,absence_started_on,notice_reference,effective_at",
      )
      .eq("provider_id", provider)
      .order("effective_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20),
    ctx.admin
      .from("cleaner_experience_clocks")
      .select("last_completed_at")
      .eq("provider_id", provider)
      .maybeSingle(),
  ]);
  if (history.error || clock.error)
    return failure("Approved absence records could not be loaded.", 503);
  return NextResponse.json(
    { history: history.data ?? [], hasCompletedJob: !!clock.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !UUID.test(body.provider ?? "") ||
    typeof body.retain !== "boolean" ||
    typeof body.reference !== "string" ||
    body.reference.trim().length < 8 ||
    body.reference.length > 500
  )
    return failure(
      "Choose a professional and record the written notice reference or reason.",
    );
  if (
    body.retain &&
    (!validDocumentDate(body.noticeReceived ?? "") ||
      !validDocumentDate(body.absenceStarted ?? ""))
  )
    return failure("Enter the notice date and the absence start date.");
  // Use the staff session, not the service client: the database checks MFA and records the actual actor.
  const { data, error } = await ctx.client.rpc("set_cleaner_rate_retention", {
    p_provider: body.provider,
    p_retain: body.retain,
    p_notice_received: body.retain ? body.noticeReceived : null,
    p_absence_started: body.retain ? body.absenceStarted : null,
    p_reference: body.reference.trim(),
  });
  if (error)
    return failure(
      "Could not save. Check that written notice preceded the absence and a completed job is recorded.",
    );
  return NextResponse.json(
    { ok: true, hourlyPence: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
