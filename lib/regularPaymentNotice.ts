import type { SupabaseClient } from "@supabase/supabase-js";
import { securityMailRecipientAllowed } from "./accountSecurityAlerts";

type Notice = {
  required: boolean;
  ready: boolean;
  id?: string;
  token?: string;
  recipient?: string;
  scheduledAt?: string;
  amountPence?: number;
  firstAttemptAt?: string;
};

/** A provider-accepted email and the durable in-app notice must precede Stripe.
 * This is essential account mail, independent of marketing/alert preferences. */
export async function ensureRegularPaymentNotice(
  admin: SupabaseClient,
  operationId: string,
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
) {
  const claimed = await admin.rpc("claim_regular_payment_notice", {
    p_operation: operationId,
  });
  if (claimed.error || !claimed.data)
    throw new Error("Regular payment notice is unavailable.");
  const notice = claimed.data as Notice;
  if (!notice.required || notice.ready) return true;
  if (!notice.id || !notice.token) return false;
  const key = env.RESEND_API_KEY;
  const sender = env.BOOKING_EMAIL_FROM ?? env.EMAIL_FROM;
  const origin = env.NEXT_PUBLIC_SITE_URL;
  let reference: string | null = null;
  try {
    if (
      !key ||
      !sender ||
      !origin?.startsWith("https://") ||
      !notice.recipient ||
      !securityMailRecipientAllowed(notice.recipient, env) ||
      !Number.isSafeInteger(notice.amountPence) ||
      notice.amountPence! <= 0 ||
      !notice.scheduledAt ||
      !Number.isFinite(Date.parse(notice.scheduledAt)) ||
      !notice.firstAttemptAt ||
      Date.now() - Date.parse(notice.firstAttemptAt) >= 23 * 3600000
    )
      return false;
    const time = new Date(notice.scheduledAt).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      dateStyle: "long",
      timeStyle: "short",
    });
    const amount = `£${(notice.amountPence! / 100).toFixed(2)}`;
    const response = await transport("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `regular-payment-notice/${notice.id}`,
      },
      body: JSON.stringify({
        from: sender,
        to: [notice.recipient],
        reply_to: "hello@opulencebliss.com",
        subject: "Your upcoming regular cleaning payment",
        text: `We will charge ${amount} for your regular cleaning visit on ${time} (London time), after sending this notice.\n\nView your visit: ${origin.replace(/\/$/, "")}/account\n\nIf you need help, contact hello@opulencebliss.com. No VAT is charged.`,
      }),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      "id" in body &&
      typeof body.id === "string"
    )
      reference = body.id;
  } catch {
    /* Keep the charge blocked and retry the same notice, without logging private data. */
  } finally {
    const finished = await admin.rpc("finish_regular_payment_notice", {
      p_id: notice.id,
      p_token: notice.token,
      p_reference: reference,
    });
    if (finished.error || finished.data !== true) reference = null;
  }
  return reference !== null;
}
