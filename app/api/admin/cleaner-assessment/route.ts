import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";

const headers = { "Cache-Control": "private, no-store" };
const id = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
function unavailable() {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers });
}
export async function GET(request: NextRequest) {
  if (!cleanerStage2Enabled()) return unavailable();
  const ctx = await adminApi(request, "onboarding");
  if (ctx instanceof NextResponse) return ctx;
  const [settings, applicants] = await Promise.all([
    ctx.client.rpc("staff_cleaner_assessment_settings"),
    ctx.client.rpc("staff_cleaner_assessment_overview"),
  ]);
  if (settings.error || applicants.error)
    return NextResponse.json(
      { error: "Assessment console is not ready." },
      { status: 503, headers },
    );
  return NextResponse.json(
    {
      settings: settings.data,
      applicants: applicants.data,
      staffRole: ctx.staffRole,
    },
    { headers },
  );
}
export async function POST(request: NextRequest) {
  if (!cleanerStage2Enabled()) return unavailable();
  const ctx = await adminApi(request, "onboarding");
  if (ctx instanceof NextResponse) return ctx;
  try {
    const input = await request.json();
    const reason =
      typeof input.reason === "string"
        ? input.reason.trim().slice(0, 1000)
        : "";
    let call;
    if (
      input.action === "adjustment" &&
      id(input.applicationId) &&
      [1, 2, 3].includes(input.multiplier)
    )
      call = ctx.client.rpc("staff_adjust_cleaner_assessment", {
        p_application: input.applicationId,
        p_multiplier: input.multiplier,
      });
    else if (reason.length < 10)
      return NextResponse.json(
        { error: "Record a reason of at least ten characters." },
        { status: 400, headers },
      );
    else if (
      input.action === "legal_hold" &&
      id(input.applicationId) &&
      typeof input.hold === "boolean"
    )
      call = ctx.client.rpc("staff_hold_cleaner_application", {
        p_application: input.applicationId,
        p_hold: input.hold,
        p_reason: reason,
      });
    else if (
      input.action === "automatic_fail" &&
      typeof input.enabled === "boolean"
    )
      call = ctx.client.rpc("staff_set_cleaner_automatic_fail_review", {
        p_enabled: input.enabled,
        p_reason: reason,
      });
    else if (
      input.action === "host" &&
      id(input.hostId) &&
      typeof input.open === "boolean"
    )
      call = ctx.client.rpc("staff_cleaner_assessment_host", {
        p_host: input.hostId,
        p_open: input.open,
        p_application: null,
        p_attended: null,
        p_reason: reason,
      });
    else if (
      input.action === "attendance" &&
      id(input.applicationId) &&
      id(input.hostId) &&
      typeof input.attended === "boolean" &&
      typeof input.open === "boolean"
    )
      call = ctx.client.rpc("staff_cleaner_assessment_host", {
        p_host: input.hostId,
        p_open: input.open,
        p_application: input.applicationId,
        p_attended: input.attended,
        p_reason: reason,
      });
    else if (
      input.action === "mark_writing" &&
      id(input.attemptId) &&
      typeof input.passed === "boolean"
    )
      call = ctx.client.rpc("staff_mark_cleaner_writing", {
        p_attempt: input.attemptId,
        p_passed: input.passed,
        p_reason: reason,
      });
    else if (
      input.action === "review" &&
      id(input.attemptId) &&
      ["confirm_fail", "reopen"].includes(input.decision)
    )
      call = ctx.client.rpc("staff_review_cleaner_assessment", {
        p_attempt: input.attemptId,
        p_action: input.decision,
        p_reason: reason,
      });
    else
      return NextResponse.json(
        { error: "Choose a valid assessment action." },
        { status: 400, headers },
      );
    // Deliberately use the caller's authenticated client, never the service
    // client: database checks enforce scoped staff, TOTP and Manager actions.
    const { error } = await call;
    if (error)
      return NextResponse.json(
        {
          error:
            "Action refused. Check your staff role, the assessment stage and the reason.",
        },
        { status: 409, headers },
      );
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Invalid assessment request." },
      { status: 400, headers },
    );
  }
}
