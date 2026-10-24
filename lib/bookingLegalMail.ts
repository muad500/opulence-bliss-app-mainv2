import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingLegalContract } from "./bookingLegalEvidence";
import {
  generateAcceptedPolicyPdf,
  generateCancellationFormPdf,
} from "./bookingLegalPdf";
import { securityMailRecipientAllowed } from "./accountSecurityAlerts";

type Delivery = {
  id: string;
  claim_token: string;
  email: string;
  contract: BookingLegalContract | null;
  payload: Record<string, unknown> | null;
};

export async function deliverBookingLegalEmails(
  admin: SupabaseClient,
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
) {
  const key = env.RESEND_API_KEY;
  const from = env.BOOKING_EMAIL_FROM ?? env.EMAIL_FROM;
  const origin = env.NEXT_PUBLIC_SITE_URL;
  const ready = Boolean(
    key &&
    from &&
    /(?:^|<|\s)no-?reply@/i.test(from) &&
    origin?.startsWith("https://"),
  );
  const { data, error } = await admin.rpc("claim_booking_legal_emails", {
    p_email_ready: ready,
  });
  if (error) return { configured: ready, sent: 0, failed: 1 };
  let sent = 0,
    failed = 0;
  for (const delivery of (data ?? []) as Delivery[]) {
    let ok = false,
      failure: string | null = null;
    try {
      if (!ready) throw new Error("Contract email is not configured");
      if (!securityMailRecipientAllowed(delivery.email, env))
        throw new Error("Staging recipient is not allowlisted");
      const contract = delivery.contract;
      if (!contract?.bookings?.length || contract.documents.length !== 3)
        throw new Error("Accepted policy snapshots are unavailable");
      let payload = delivery.payload;
      if (!payload) {
        const attachments: Array<{ filename: string; content: string }> = [];
        for (const document of contract.documents)
          attachments.push({
            filename: `${document.slug}-version-${document.version.replace(/[^a-z0-9.-]/gi, "_")}.pdf`,
            content: Buffer.from(
              await generateAcceptedPolicyPdf(document, contract.acceptedAt),
            ).toString("base64"),
          });
        attachments.push({
          filename: "model-cancellation-form.pdf",
          content: Buffer.from(
            await generateCancellationFormPdf(contract.acceptedAt),
          ).toString("base64"),
        });
        payload = {
          from,
          to: [delivery.email],
          reply_to: "hello@opulencebliss.com",
          subject: "Your Opulence Bliss booking policies",
          text: [
            "Thank you for booking with Opulence Bliss.",
            "Attached are the Terms & Conditions, Cancellation & Refund Policy and Privacy Policy versions you accepted, plus a model cancellation form. Keep these documents for your records.",
            `Accepted: ${new Date(contract.acceptedAt).toISOString()} (UTC).`,
            ...contract.bookings.map(
              (booking) =>
                `${booking.service} — ${new Date(booking.scheduledAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "long", timeStyle: "short" })} (London time). Reference: ${booking.id}.`,
            ),
            `View your booking: ${origin!.replace(/\/$/, "")}/account/visit/${contract.bookings[0].id}`,
            "You do not have to use the attached form to cancel. Your accepted policies explain your cancellation rights. Contact hello@opulencebliss.com if you need help.",
          ].join("\n\n"),
          attachments,
        };
        // Save the exact request before sending; retries reuse identical bytes.
        const stored = await admin.rpc("store_booking_legal_email_payload", {
          p_id: delivery.id,
          p_token: delivery.claim_token,
          p_payload: payload,
        });
        if (stored.error || !stored.data)
          throw new Error("Could not store the contract email");
        payload = stored.data;
      }
      const response = await transport("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `booking-legal/${delivery.id}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(`Contract email provider returned ${response.status}`);
      ok = true;
    } catch (error) {
      failure =
        error instanceof Error ? error.message : "Contract email failed";
    }
    const finish = await admin.rpc("finish_booking_legal_email", {
      p_id: delivery.id,
      p_token: delivery.claim_token,
      p_ok: ok,
      p_error: failure,
    });
    if (finish.error || finish.data !== true || !ok) failed++;
    else sent++;
  }
  return { configured: ready, sent, failed };
}
