import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;
type Delivery = { id: string; claim_token: string; email: string | null; title: string; body: string; href: string };

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const key = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM ?? process.env.EMAIL_FROM;
  const origin = process.env.NEXT_PUBLIC_SITE_URL;
  const ready = Boolean(key && from && /(?:^|<|\s)no-?reply@/i.test(from) && origin?.startsWith("https://"));
  const { data, error } = await admin.rpc("claim_booking_emails", { p_email_ready: ready });
  if (error) return NextResponse.json({ error: "Could not process notifications." }, { status: 500 });
  let sent = 0;
  let failed = 0;
  const deliveries = (data ?? []) as Delivery[];
  for (let offset = 0; offset < deliveries.length; offset += 5) {
    await Promise.all(deliveries.slice(offset, offset + 5).map(async (delivery) => {
    let ok = false;
    let failure: string | null = null;
    try {
      const { data: permitted, error: preferenceError } = await admin.rpc("booking_email_preference_allowed", { p_id: delivery.id });
      if (preferenceError) throw new Error("Notification preferences could not be checked.");
      if (permitted !== true) {
        const { error: skipError } = await admin.rpc("skip_booking_email", { p_id: delivery.id, p_token: delivery.claim_token });
        if (skipError) failed++;
        return;
      }
      if (!ready) throw new Error("Configure RESEND_API_KEY, a verified no-reply BOOKING_EMAIL_FROM, and HTTPS NEXT_PUBLIC_SITE_URL.");
      if (!delivery.email) throw new Error("Customer email is missing.");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `booking-notice/${delivery.id}` },
        body: JSON.stringify({ from, to: [delivery.email], subject: delivery.title,
          text: `${delivery.body}\n\nView your booking: ${origin!.replace(/\/$/, "")}${delivery.href}` }),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
      ok = true;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Email delivery failed.";
    }
    const { error: finishError } = await admin.rpc("finish_booking_email", {
      p_id: delivery.id, p_token: delivery.claim_token, p_ok: ok, p_error: failure,
    });
    if (finishError || !ok) failed++; else sent++;
    }));
  }
  return NextResponse.json({ sent, failed, emailConfigured: ready }, { status: failed || !ready ? 503 : 200 });
}
