import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { parseOnboardingAction } from "@/lib/cleanerOnboardingWorkflow";
import {
  onboardingAccess,
  hashOnboardingAccess,
} from "@/lib/cleanerOnboardingAccess";

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
    if (["invite", "publish_decision"].includes(input?.action)) {
      if (
        typeof input.applicationId !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
          input.applicationId,
        )
      )
        throw Error();
      let result;
      if (input.action === "invite") {
        const starts = new Date(input.startsAt);
        if (
          !Number.isFinite(starts.getTime()) ||
          typeof input.meetingUrl !== "string"
        )
          throw Error();
        const expires = new Date(
          starts.getTime() + 6 * 60 * 60 * 1000,
        ).toISOString();
        const token = onboardingAccess(
          input.applicationId,
          "induction",
          expires,
        );
        result = await ctx.client.rpc("staff_issue_cleaner_induction", {
          p_application: input.applicationId,
          p_starts: starts.toISOString(),
          p_meeting: input.meetingUrl,
          p_token_hash: hashOnboardingAccess(token),
          p_expires: expires,
          p_host: null,
        });
      } else {
        if (process.env.CLEANER_SECURE_DBS_DECISIONS_ENABLED !== "true")
          return NextResponse.json(
            { error: "Secure DBS decision delivery remains disabled." },
            { status: 409, headers },
          );
        for (const key of ["decision", "reasons", "explanation"])
          if (
            typeof input[key] !== "string" ||
            input[key].trim().length < 10 ||
            input[key].length > 4000
          )
            throw Error();
        if (!["suitable", "not_suitable"].includes(input.suitability))
          throw Error();
        const expires = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000 - 1000,
        ).toISOString();
        const token = onboardingAccess(
          input.applicationId,
          "decision",
          expires,
        );
        result = await ctx.client.rpc("staff_publish_cleaner_decision", {
          p_application: input.applicationId,
          p_decision: input.decision,
          p_reasons: input.reasons,
          p_explanation: input.explanation,
          p_token_hash: hashOnboardingAccess(token),
          p_expires: expires,
          p_suitable: input.suitability === "suitable",
        });
      }
      if (result.error)
        return NextResponse.json(
          {
            error:
              "Action refused. Check the completed stages, named staff access, session and Manager permissions.",
          },
          { status: 409, headers },
        );
      return NextResponse.json({ ok: true }, { headers });
    }
    if (input?.action === "checklist") {
      if (
        typeof input.applicationId !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
          input.applicationId,
        ) ||
        typeof input.group !== "string" ||
        typeof input.item !== "string" ||
        typeof input.checked !== "boolean" ||
        typeof input.note !== "string" ||
        input.note.trim().length < 10 ||
        input.note.length > 2000
      )
        throw Error();
      const result = await ctx.client.rpc("staff_tick_cleaner_checklist", {
        p_application: input.applicationId,
        p_group: input.group,
        p_item: input.item,
        p_checked: input.checked,
        p_note: input.note.trim(),
      });
      if (result.error)
        return NextResponse.json(
          {
            error:
              "Checklist change refused. Check your permissions and the open application.",
          },
          { status: 409, headers },
        );
      return NextResponse.json({ ok: true }, { headers });
    }
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
      if (result.error || result.data?.accessDenied)
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
            "Action refused. Check the stage, required checklist approval, evidence and your staff permissions.",
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
