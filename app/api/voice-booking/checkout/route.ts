import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createCustomerCheckout } from "@/lib/customerCheckoutServer";
import { ownsVoiceBooking, VoiceBookingError, voiceCheckoutBody } from "@/lib/voiceBooking";
import { voiceBookingAdmin, voiceRequestByToken } from "@/lib/voiceBookingServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin) throw new VoiceBookingError("Open checkout from the booking page.", 403);
    const input = await req.json();
    if (input.reviewConfirmed !== true) throw new VoiceBookingError("Review and confirm the booking details first.");
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) throw new VoiceBookingError("Sign in before continuing to payment.", 401);
    const db = voiceBookingAdmin();
    const row = await voiceRequestByToken(db, String(input.token ?? ""));
    if (!ownsVoiceBooking(user.email, user.email_confirmed_at, user.id, row)) throw new VoiceBookingError("Sign in with the verified email address you gave the receptionist.", 403);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    if (row.checkout_session_id) {
      const session = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
      if (session.client_reference_id !== user.id) throw new VoiceBookingError("Checkout belongs to another account.", 403);
      if (session.status === "complete") return NextResponse.json({ url: `/api/book/finalize?session_id=${encodeURIComponent(session.id)}` });
      if (session.status === "open" && session.url) return NextResponse.json({ url: session.url });
      throw new VoiceBookingError("This payment session expired. Ask the receptionist to prepare a new request.", 410);
    }
    if (Date.parse(row.expires_at) <= Date.now()) throw new VoiceBookingError("This booking request expired. Ask the receptionist for a new request.", 410);
    // Stable evidence and payment parameters ensure an interrupted/retried POST
    // reuses one Stripe session rather than creating another payable checkout.
    const earlyStartAt = row.early_start_requested_at ?? new Date().toISOString();
    const claim = await db.from("voice_booking_requests").update({ customer_id: user.id, ...(input.earlyStartRequested === true ? { early_start_requested_at: earlyStartAt } : {}) }).eq("id", row.id).is("customer_id", null).select("*").maybeSingle();
    if (claim.error) throw new VoiceBookingError("Could not save the checkout request. Try again.", 503);
    const current = claim.data ?? await voiceRequestByToken(db, String(input.token));
    if (current.customer_id !== user.id) throw new VoiceBookingError("This request belongs to another account.", 403);
    if (input.earlyStartRequested === true && !current.early_start_requested_at) {
      const updated = await db.from("voice_booking_requests").update({ early_start_requested_at: earlyStartAt }).eq("id", row.id).is("early_start_requested_at", null).select("*").maybeSingle();
      if (updated.error) throw new VoiceBookingError("Could not record your service-start request.", 503);
      current.early_start_requested_at = updated.data?.early_start_requested_at ?? (await voiceRequestByToken(db, String(input.token))).early_start_requested_at;
    }
    const checkout = await createCustomerCheckout(new NextRequest(new URL("/api/checkout", req.nextUrl.origin), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(voiceCheckoutBody(row.details, input.earlyStartRequested === true)),
    }), {
      idempotencyKey: `voice-booking-${row.id}`, transferGroup: `ob_voice_${row.id}`,
      earlyStartRequestedAt: current.early_start_requested_at ?? undefined,
      expectedTotalPence: Math.round(row.quote.total_gbp * 100),
      useReviewedPhone: true,
      cancelPath: `/book/voice/${row.access_token}`,
    });
    const result = await checkout.json();
    if (!checkout.ok) return NextResponse.json(result, { status: checkout.status });
    if (!result.sessionId || !result.url) throw new VoiceBookingError("Checkout could not be prepared.", 503);
    const saved = await db.from("voice_booking_requests").update({ checkout_session_id: result.sessionId }).eq("id", row.id).eq("customer_id", user.id);
    if (saved.error) throw new VoiceBookingError("The payment link could not be saved. Try again; no additional checkout will be created.", 503);
    return NextResponse.json({ url: result.url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof VoiceBookingError)) console.error("Voice checkout failed.");
    return NextResponse.json({ error: error instanceof VoiceBookingError ? error.message : "Could not prepare checkout. Please try again." }, { status: error instanceof VoiceBookingError ? error.status : 503 });
  }
}
