import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bookingSmsConfig,
  bookingSmsText,
  submitBookingSms,
} from "./bookingSms";

type Environment = Record<string, string | undefined>;
type Notice = {
  id: string;
  claim_token: string;
  channel: "email" | "sms";
  recipient: string | null;
  title: string;
  body: string;
  href: string;
  kind: string;
  booking_id: string;
  scheduled_at: string;
};

/** Provider acceptance is recorded separately from reading an in-app message.
 * Email retries reuse the same provider idempotency key. An uncertain SMS is
 * never automatically resent, matching the existing SMS budget policy. */
export async function deliverVisitMatchingNotices(
  admin: SupabaseClient,
  env: Environment,
  fetcher: typeof fetch = fetch,
) {
  const key = env.RESEND_API_KEY;
  const sender = env.BOOKING_EMAIL_FROM ?? env.EMAIL_FROM;
  const origin = env.NEXT_PUBLIC_SITE_URL;
  // Sandbox queues may contain old fixtures. Never deliver them to unapproved
  // recipients. Production does not use this staging-only restriction.
  const stagingRecipients =
    env.VISIT_PAYMENTS_MODE === "staging"
      ? new Set(
          (env.STAGING_EMAIL_RECIPIENTS ?? "")
            .split(",")
            .map((recipient) => recipient.trim().toLowerCase())
            .filter((recipient) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient),
            ),
        )
      : null;
  const emailEnabled = Boolean(
    key &&
    sender &&
    origin?.startsWith("https://") &&
    (stagingRecipients === null || stagingRecipients.size > 0),
  );
  const sms = bookingSmsConfig(env);
  const { data, error } = await admin.rpc("claim_visit_matching_notices", {
    p_email_enabled: emailEnabled,
    p_sms_enabled: Boolean(sms),
    p_budget_pence: sms?.monthlyBudgetPence ?? 0,
    p_cost_pence: sms?.costCapPence ?? 0,
  });
  if (error) throw new Error("Matching notices could not be claimed.");
  let submitted = 0;
  let failed = 0;
  let excluded = 0;
  for (const notice of (data ?? []) as Notice[]) {
    let reference: string | null = null;
    let failure: string | null = null;
    try {
      const { data: allowed, error: checkError } = await admin.rpc(
        "visit_matching_notice_allowed",
        { p_id: notice.id, p_token: notice.claim_token },
      );
      if (checkError)
        throw new Error("Matching notice state could not be checked.");
      if (allowed !== true) {
        failure = "Notice no longer applies.";
        continue;
      }
      if (!notice.recipient)
        throw new Error("Notification destination is missing.");
      if (notice.channel === "email") {
        if (!emailEnabled || !key || !sender || !origin)
          throw new Error("Staging email is not configured.");
        if (
          stagingRecipients &&
          !stagingRecipients.has(notice.recipient.trim().toLowerCase())
        ) {
          failure = "Staging recipient is not approved for test delivery.";
          excluded++;
          continue;
        }
        if (!notice.href.startsWith("/") || notice.href.startsWith("//"))
          throw new Error("Invalid booking link.");
        const response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `visit-matching/${notice.id}`,
          },
          body: JSON.stringify({
            from: sender,
            to: [notice.recipient],
            subject: notice.title,
            text: `${notice.body}\n\nView your booking: ${new URL(notice.href, origin).toString()}`,
          }),
        });
        if (!response.ok)
          throw new Error(`Email provider returned ${response.status}.`);
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("id" in result) ||
          typeof result.id !== "string"
        )
          throw new Error("Email acceptance was not confirmed.");
        reference = result.id;
      } else {
        if (!sms) throw new Error("SMS remains switched off.");
        reference = await submitBookingSms(
          sms,
          notice.recipient,
          bookingSmsText(notice.kind, notice.booking_id, notice.scheduled_at),
          fetcher,
        );
      }
      submitted++;
    } catch {
      // Credentials, addresses and provider response bodies never reach logs.
      failure = "Notification submission failed or is uncertain.";
      failed++;
    } finally {
      const { error: finishError } = await admin.rpc(
        "finish_visit_matching_notice",
        {
          p_id: notice.id,
          p_token: notice.claim_token,
          p_reference: reference,
          p_error: failure,
        },
      );
      if (finishError) failed++;
    }
  }
  return {
    emailConfigured: emailEnabled,
    smsEnabled: Boolean(sms),
    submitted,
    failed,
    excluded,
  };
}
