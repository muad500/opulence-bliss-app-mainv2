import type { SupabaseClient } from "@supabase/supabase-js";
import { webPushEnabled } from "./webPushPolicy";
import { notificationLink } from "./adminHosts";
export async function deliverExtraNotificationEmails(admin: SupabaseClient) {
  if (!webPushEnabled(process.env)) return { sent: 0, failed: 0 };
  const key = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM ?? process.env.EMAIL_FROM;
  const origin = process.env.NEXT_PUBLIC_SITE_URL;
  if (!key || !from || !origin?.startsWith("https://"))
    return { sent: 0, failed: 0, configured: false };
  // Staging only: never mail real accounts from a synthetic test run.
  const recipients = new Set(
    (process.env.STAGING_EMAIL_RECIPIENTS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const { data, error } = await admin.rpc("claim_extra_notification_emails");
  if (error) throw new Error("Email queue unavailable");
  let sent = 0,
    failed = 0;
  for (const row of data ?? []) {
    let outcome = "cancelled";
    try {
      const check = await admin.rpc("extra_notification_email_allowed", {
        p_id: row.id,
        p_token: row.claim_token,
      });
      if (check.error) throw new Error();
      if (check.data && recipients.has(String(row.email).toLowerCase())) {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `notification-extra/${row.id}`,
          },
          body: JSON.stringify({
            from,
            to: [row.email],
            subject: row.title,
            text: `You have an Opulence Bliss account update. Open your account for details:\n${notificationLink(row.href, origin, process.env)}`,
          }),
        });
        if (!response.ok) throw new Error();
        sent++;
        outcome = "sent";
      }
    } catch {
      failed++;
      outcome = "retry";
    }
    const finish = await admin.rpc("finish_extra_notification_email", {
      p_id: row.id,
      p_token: row.claim_token,
      p_outcome: outcome,
    });
    if (finish.error) throw new Error("Email result unavailable");
  }
  return { sent, failed, configured: true };
}
