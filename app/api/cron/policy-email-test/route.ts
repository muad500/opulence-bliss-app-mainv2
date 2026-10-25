import { timingSafeEqual, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { bookingLegalEmailPayload } from "@/lib/bookingLegalEmailPayload";
import { loadCheckoutPolicyCopy, policyCopyId } from "@/lib/checkoutPolicyCopy";
import { securityMailRecipientAllowed } from "@/lib/accountSecurityAlerts";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    !secret ||
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const from = process.env.BOOKING_EMAIL_FROM ?? process.env.EMAIL_FROM;
  const origin = process.env.NEXT_PUBLIC_SITE_URL;
  const key = process.env.RESEND_API_KEY;
  if (
    !key ||
    !from ||
    !/(?:^|<|\s)no-?reply@/i.test(from) ||
    !origin?.startsWith("https://")
  )
    return NextResponse.json(
      { error: "Policy email is not configured" },
      { status: 503 },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return NextResponse.json({ error: "Send JSON" }, { status: 415 });
  const raw = await request.text();
  if (raw.length > 1000)
    return NextResponse.json(
      { error: "Request is too large" },
      { status: 413 },
    );
  const body = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  if (
    !policyCopyId(body?.consentId ?? "") ||
    typeof body?.recipient !== "string" ||
    body.recipient.length > 254
  )
    return NextResponse.json(
      { error: "Invalid test request" },
      { status: 400 },
    );
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const copy = await loadCheckoutPolicyCopy(admin, body.consentId);
    const recipient = body.recipient.trim().toLowerCase();
    if (
      !copy?.evidence.account ||
      copy.evidence.account.email.trim().toLowerCase() !== recipient ||
      !securityMailRecipientAllowed(recipient, process.env)
    )
      return NextResponse.json(
        { error: "Use the verified checkout owner's inbox" },
        { status: 403 },
      );
    const owner = await admin.auth.admin.getUserById(
      copy.evidence.account.userId,
    );
    if (
      owner.error ||
      !owner.data.user?.email_confirmed_at ||
      owner.data.user.email?.toLowerCase() !== recipient
    )
      return NextResponse.json(
        { error: "The checkout owner's email must be verified" },
        { status: 403 },
      );
    const linked = await admin
      .from("account_legal_acceptances")
      .select("booking_id", { count: "exact", head: true })
      .eq("checkout_legal_consent_id", copy.id)
      .not("booking_id", "is", null);
    if (linked.error || linked.count !== 0)
      return NextResponse.json(
        { error: "This test requires an unfinished checkout" },
        { status: 409 },
      );
    const payload = await bookingLegalEmailPayload(copy, recipient, {
      from,
      origin,
      test: true,
    });
    // Identical retries reuse the provider's 24-hour idempotency window.
    const digest = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `policy-test/${copy.id}/${digest}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok)
      return NextResponse.json(
        { error: `Test email provider returned ${response.status}` },
        { status: 503 },
      );
    const result = await response.json();
    if (typeof result?.id !== "string")
      throw new Error("Email acceptance was not confirmed");
    return NextResponse.json(
      {
        ok: true,
        testOnly: true,
        emailId: result.id,
        attachments: payload.attachments.map(({ filename }) => filename),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "The test email could not be confirmed; use the same request to retry",
      },
      { status: 503 },
    );
  }
}
