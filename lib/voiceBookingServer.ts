import "server-only";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { prepareAssistantBooking } from "@/lib/assistantBookingServer";
import { sendEmail } from "@/lib/email";
import { escapeVoiceHtml, VoiceBookingError, voiceBookingDetails, voiceBookingFingerprint, type VoiceDetails } from "@/lib/voiceBooking";

export type VoiceQuote = Awaited<ReturnType<typeof prepareAssistantBooking>>;
export type VoiceRequest = {
  id: string; access_token: string; agent_id: string; call_id: string; email: string;
  details: VoiceDetails; quote: VoiceQuote; customer_id: string | null;
  checkout_session_id: string | null; early_start_requested_at: string | null;
  email_sent_at: string | null; created_at: string; expires_at: string;
};

export function voiceBookingAdmin() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new VoiceBookingError("Voice booking storage is not configured.", 503);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function voiceBookingOrigin() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) throw new VoiceBookingError("Set the website URL before sending booking links.", 503);
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new VoiceBookingError("Booking emails require the website's HTTPS origin.", 503);
  return url.origin;
}

export async function voiceRequestByToken(db: SupabaseClient, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new VoiceBookingError("This booking link is invalid.", 404);
  const { data, error } = await db.from("voice_booking_requests").select("*").eq("access_token", token).maybeSingle();
  if (error) throw new VoiceBookingError("Could not load the booking request.", 503);
  if (!data) throw new VoiceBookingError("This booking link is invalid.", 404);
  return data as VoiceRequest;
}

export async function createVoiceRequest(db: SupabaseClient, agentId: string, callId: string, args: Record<string, unknown>) {
  const details = voiceBookingDetails(args);
  const origin = voiceBookingOrigin();
  const fingerprint = voiceBookingFingerprint(agentId, callId, details);
  const existing = await db.from("voice_booking_requests").select("*").eq("fingerprint", fingerprint).maybeSingle();
  if (existing.error) throw new VoiceBookingError("Voice booking storage is unavailable. Apply the voice booking migration first.", 503);
  let row = existing.data as VoiceRequest | null;
  if (!row) {
    const quote = await prepareAssistantBooking(db, details);
    const saved = await db.from("voice_booking_requests").insert({
      access_token: randomBytes(32).toString("hex"), fingerprint, agent_id: agentId,
      call_id: callId, email: details.email, details, quote,
    }).select("*").single();
    if (saved.error?.code === "23505") {
      const duplicate = await db.from("voice_booking_requests").select("*").eq("fingerprint", fingerprint).single();
      if (duplicate.error) throw new VoiceBookingError("Could not recover the booking request. Try again.", 503);
      row = duplicate.data as VoiceRequest;
    } else {
      if (saved.error) throw new VoiceBookingError("Could not save the booking request. Nothing has been booked or paid.", 503);
      row = saved.data as VoiceRequest;
    }
  }
  if (Date.parse(row.expires_at) <= Date.now()) throw new VoiceBookingError("This request expired. Confirm a new time and create a new request.", 410);
  let sent = !!row.email_sent_at;
  if (!sent) {
    const html = escapeVoiceHtml;
    const appointment = new Date(row.details.slot).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "full", timeStyle: "short" });
    const result = await sendEmail({
      to: row.email, subject: "Finish your Opulence Bliss booking", title: "Your booking details are ready",
      body: `<p>Hello ${html(row.details.customer_name)},</p><p>Your AI receptionist prepared ${html(row.quote.service)} at ${html(row.details.address)}, ${html(row.details.postcode)} for ${html(appointment)} (London time).</p><p>${row.details.duration_minutes / 60} hours per visit, ${row.quote.visits} visit(s). Total: £${row.quote.total_gbp.toFixed(2)}.</p><p>Sign in with this email address, review the details and continue to secure payment. You do not need to fill out the booking form again. This request expires in 24 hours; the appointment must still meet the minimum notice when you finish.</p><p>Your booking is confirmed only after payment or card authorisation succeeds and the booking is saved. A cleaner is matched afterwards.</p>`,
      cta: { text: "Review and pay", url: `${origin}/book/voice/${row.access_token}` },
      idempotencyKey: `voice-booking-${row.id}`,
    });
    sent = result.ok;
    if (sent) await db.from("voice_booking_requests").update({ email_sent_at: new Date().toISOString() }).eq("id", row.id);
  }
  return {
    request_id: row.id, status: "awaiting_payment", email_sent: sent,
    service: row.quote.service, total_gbp: row.quote.total_gbp, visits: row.quote.visits,
    preferred_time: row.details.slot, time_zone: "Europe/London",
    note: sent ? "The booking request is saved and the email provider accepted the review/payment link. Ask the caller to check their inbox and spam folder. The booking is not confirmed yet; they must sign in, review and finish payment or card authorisation. A cleaner is matched afterwards."
      : "The request is saved, but the email could not be sent. Do not say a link was sent or a booking confirmed. Ask to retry the same details or contact support.",
  };
}

/** Retell can inspect only a request created by this same signed agent and call. */
export async function voiceRequestStatus(db: SupabaseClient, agentId: string, callId: string, requestId: unknown) {
  if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new VoiceBookingError("Use the request ID returned by create_voice_booking.");
  const { data, error } = await db.from("voice_booking_requests").select("*").eq("id", requestId).eq("agent_id", agentId).eq("call_id", callId).maybeSingle();
  if (error) throw new VoiceBookingError("Could not check the booking request.", 503);
  if (!data) throw new VoiceBookingError("This booking request does not belong to this call.", 404);
  const row = data as VoiceRequest;
  if (row.checkout_session_id && row.customer_id) {
    const bookings = await db.from("bookings").select("id,status").eq("checkout_session_id", row.checkout_session_id).eq("customer_id", row.customer_id);
    if (bookings.error) throw new VoiceBookingError("Could not verify the saved booking.", 503);
    if (bookings.data.some((item) => item.status === "cancelled")) return { status: "changed", note: "One or more visits have been cancelled. Refer the customer to their account/support to check the current schedule; do not confirm the original booking unchanged." };
    if (bookings.data.length >= row.quote.visits) return { status: "confirmed", booking_ids: bookings.data.map((item) => item.id), note: "Payment/card authorisation succeeded and the bookings were saved. A cleaner is matched afterwards; do not promise a cleaner is already assigned." };
    if (bookings.data.length) return { status: "processing", note: "The booking is still being saved. Do not confirm the full booking yet." };
  }
  const expired = Date.parse(row.expires_at) <= Date.now();
  return { status: expired ? "expired" : "awaiting_payment", email_sent: !!row.email_sent_at, note: expired ? "The request expired. Do not confirm a booking." : "No confirmed booking is saved yet. Ask the caller to finish the emailed checkout; do not confirm or guarantee a cleaner." };
}
