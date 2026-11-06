import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/accountApi";
import {
  cleanerStage2Enabled,
  parseCleanerApplication,
} from "@/lib/cleanerApplication";
import { CLEANER_ONBOARDING_MISSING_SOURCES } from "@/lib/cleanerOnboardingPlaceholders";
import { finalLegalDocument } from "@/lib/finalLegalPack";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const success = () => NextResponse.json({ ok: true }, { headers });

export async function POST(request: NextRequest) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open this form from the website." },
      { status: 403, headers },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    return NextResponse.json(
      { error: "The form is too large." },
      { status: 413, headers },
    );
  let raw: Record<string, unknown>, details;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 16000)
      return NextResponse.json(
        { error: "The form is too large." },
        { status: 413, headers },
      );
    raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error();
    if (typeof raw.website !== "string" || raw.website.trim()) return success();
    details = parseCleanerApplication(raw);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && !(error instanceof SyntaxError)
            ? error.message
            : "Check your application details.",
      },
      { status: 400, headers },
    );
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ip =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : null;
  if (!key || !url || (process.env.VERCEL === "1" && (!ip || !isIP(ip))))
    return NextResponse.json(
      { error: "Applications are temporarily unavailable." },
      { status: 503, headers },
    );
  const declaration = CLEANER_ONBOARDING_MISSING_SOURCES.applicationNotice;
  if (declaration.status !== "approved")
    return NextResponse.json(
      { error: "Application wording is unavailable." },
      { status: 503, headers },
    );
  const privacy = finalLegalDocument("privacy");
  if (!privacy)
    return NextResponse.json(
      { error: "The Privacy Notice is unavailable." },
      { status: 503, headers },
    );
  try {
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rateKey = createHmac("sha256", key)
      .update(`cleaner-application:${ip ?? "local-test"}`)
      .digest("hex");
    const result = await admin.rpc("intake_cleaner_application", {
      p_details: details,
      p_declaration: declaration.wording,
      p_source: declaration.reference,
      p_privacy_version: privacy.version,
      p_ip: ip,
      p_rate_key: rateKey,
    });
    if (result.error) throw Error();
    if (result.data?.limited)
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { ...headers, "Retry-After": "3600" } },
      );
    // No account, provider or invitation. The approved, versioned confirmation
    // is queued transactionally and sent only by the allowlisted worker.
    return success();
  } catch {
    return NextResponse.json(
      { error: "Applications are temporarily unavailable. Please try again." },
      { status: 503, headers },
    );
  }
}
