import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/accountApi";
import { partnerInterestInput } from "@/lib/partnerInterest";
import { PARTNER_INTEREST_CONSENT } from "@/lib/partnerInterestCopy";
import { deliverPartnerInterestEmails } from "@/lib/partnerInterestDelivery";

export const runtime = "nodejs";
const success = () =>
  NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open this request from the website." },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    return NextResponse.json(
      { error: "The form is too large." },
      { status: 413 },
    );
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 4096)
      return NextResponse.json(
        { error: "The form is too large." },
        { status: 413 },
      );
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
  } catch {
    return NextResponse.json(
      { error: "Check the form and try again." },
      { status: 400 },
    );
  }
  // Bots get the same result without a record, email or validation oracle.
  if (typeof body.website !== "string" || body.website.trim()) return success();
  const checked = partnerInterestInput(body);
  if (checked.fields)
    return NextResponse.json(
      { error: "Please check the highlighted fields.", fields: checked.fields },
      { status: 400 },
    );
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const forwarded =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : null;
  if (
    !key ||
    !url ||
    (process.env.VERCEL === "1" && (!forwarded || !isIP(forwarded)))
  )
    return NextResponse.json(
      {
        error:
          "Registration is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  const ip = forwarded && isIP(forwarded) ? forwarded : null;
  const rateKey = createHmac("sha256", key)
    .update(`partner-interest/v1:${ip ?? "local-development"}`)
    .digest("hex");
  try {
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const saved = await admin.rpc("register_partner_interest", {
      p_name: checked.input.fullName,
      p_email: checked.input.email,
      p_phone: checked.input.phone,
      p_description: checked.input.description,
      p_consent: PARTNER_INTEREST_CONSENT,
      p_ip: ip,
      p_rate_key: rateKey,
    });
    if (saved.error) throw Error();
    const result = saved.data as {
      limited?: boolean;
      duplicate?: boolean;
      id?: string;
    };
    if (result.limited)
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": "3600", "Cache-Control": "no-store" },
        },
      );
    // A queue is created atomically with the first record. Duplicates neither
    // enqueue nor wake another email. Delivery failure is retried by the cron.
    if (result.id && !result.duplicate)
      await deliverPartnerInterestEmails(admin, result.id).catch(
        () => undefined,
      );
    return success();
  } catch {
    return NextResponse.json(
      {
        error:
          "Registration is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }
}
