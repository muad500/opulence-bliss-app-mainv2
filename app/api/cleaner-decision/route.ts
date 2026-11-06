import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isSameOriginMutation } from "@/lib/accountApi";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import {
  decisionCookie,
  hashOnboardingAccess,
  validOnboardingAccess,
} from "@/lib/cleanerOnboardingAccess";

export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
async function open(token: string, review: string | null = null) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client.rpc("open_cleaner_secure_decision", {
    p_hash: hashOnboardingAccess(token),
    p_review: review,
  });
}
export async function GET(request: NextRequest) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const token = request.cookies.get(decisionCookie)?.value;
  if (!validOnboardingAccess(token))
    return NextResponse.json(
      { error: "Open your personal decision link." },
      { status: 401, headers },
    );
  const result = await open(token);
  if (result.error || !result.data)
    return NextResponse.json(
      {
        error:
          "This decision link has expired or was withdrawn. Contact hello@opulencebliss.com.",
      },
      { status: 403, headers },
    );
  return NextResponse.json(result.data, { headers });
}
export async function POST(request: NextRequest) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open this request from the website." },
      { status: 403, headers },
    );
  try {
    const text = await request.text();
    if (text.length > 6000) throw Error();
    const body = JSON.parse(text);
    const token =
      body.action === "open"
        ? body.access
        : request.cookies.get(decisionCookie)?.value;
    if (
      !validOnboardingAccess(token) ||
      !["open", "review"].includes(body.action)
    )
      throw Error();
    const review = body.action === "review" ? body.statement : null;
    if (
      review !== null &&
      (typeof review !== "string" ||
        review.trim().length < 10 ||
        review.length > 4000)
    )
      throw Error();
    const result = await open(token, review);
    if (result.error || !result.data)
      return NextResponse.json(
        {
          error:
            "This personal decision is unavailable. Contact hello@opulencebliss.com.",
        },
        { status: 403, headers },
      );
    const response = NextResponse.json(result.data, { headers });
    response.cookies.set(decisionCookie, token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.json(
      {
        error:
          "Use your personal link, or enter an explanation of 10 to 4,000 characters.",
      },
      { status: 400, headers },
    );
  }
}
