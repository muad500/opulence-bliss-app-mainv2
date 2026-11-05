import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { parseOnboardingAction } from "@/lib/cleanerOnboardingWorkflow";

const headers = { "Cache-Control": "private, no-store" };
const unavailable = () =>
  NextResponse.json({ error: "Not found" }, { status: 404, headers });

export async function GET(request: NextRequest) {
  if (!cleanerStage2Enabled()) return unavailable();
  const ctx = await adminApi(request, "onboarding");
  if (ctx instanceof NextResponse) return ctx;
  const result = await ctx.client.rpc("staff_cleaner_applications");
  if (result.error)
    return NextResponse.json(
      { error: "Applications could not be loaded." },
      { status: 503, headers },
    );
  return NextResponse.json(
    { applications: result.data, staffRole: ctx.staffRole },
    { headers },
  );
}

export async function POST(request: NextRequest) {
  if (!cleanerStage2Enabled()) return unavailable();
  const ctx = await adminApi(request, "onboarding");
  if (ctx instanceof NextResponse) return ctx;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 12000)
      return NextResponse.json(
        { error: "The record is too large." },
        { status: 413, headers },
      );
    const input = JSON.parse(text);
    if (input?.action === "open") {
      if (
        typeof input.applicationId !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
          input.applicationId,
        )
      )
        throw Error("Choose an application.");
      const result = await ctx.client.rpc("staff_open_cleaner_application", {
        p_application: input.applicationId,
        p_private: input.private === true,
      });
      if (result.error)
        return NextResponse.json(
          {
            error:
              "Record access refused. Check named access and Manager review.",
          },
          { status: 403, headers },
        );
      return NextResponse.json({ record: result.data }, { headers });
    }
    const action = parseOnboardingAction(input);
    const result = await ctx.client.rpc("staff_record_cleaner_application", {
      p_application: action.applicationId,
      p_action: action.action,
      p_stage: action.stage,
      p_details: action.details,
      p_note: action.note,
    });
    if (result.error)
      return NextResponse.json(
        {
          error:
            "Action refused. Check the stage, required source checklist, evidence and your staff permissions.",
        },
        { status: 409, headers },
      );
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Check the application action and record a note of 10 to 2,000 characters.",
      },
      { status: 400, headers },
    );
  }
}
