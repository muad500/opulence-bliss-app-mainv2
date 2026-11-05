import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanerStage2Enabled } from "./cleanerApplication";
import { CLEANER_ASSESSMENT_COPY as copy } from "./cleanerAssessmentPolicy";
import { accountMailReady, sendPrivateAccountMail } from "./privateAccountMail";

export async function deliverCleanerAssessmentDecisions(admin: SupabaseClient) {
  const recipients = [
    ...new Set(
      (process.env.STAGING_EMAIL_RECIPIENTS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    ),
  ];
  const sender =
    process.env.ACCOUNT_EMAIL_FROM ??
    process.env.BOOKING_EMAIL_FROM ??
    process.env.EMAIL_FROM;
  if (
    !cleanerStage2Enabled() ||
    !accountMailReady() ||
    !sender ||
    !/(?:^|<)staging@opulencebliss\.com>?$/i.test(sender) ||
    !recipients.length ||
    recipients.length > 50
  )
    return { sent: 0, failed: 0, configured: false };
  const claimed = await admin.rpc("claim_cleaner_assessment_emails", {
    p_allowed: recipients,
  });
  if (claimed.error || !Array.isArray(claimed.data))
    throw Error("Assessment email queue unavailable.");
  let sent = 0,
    failed = 0;
  for (const row of claimed.data) {
    const delivered =
      row.copy_version === "1.0" &&
      recipients.includes(String(row.email).toLowerCase()) &&
      (await sendPrivateAccountMail(
        row.email,
        copy.failedEmailSubject,
        `${copy.notPassed}\n\n${copy.review}`,
        `cleaner-assessment-decision:${row.id}`,
      ));
    const result = await admin.rpc("finish_cleaner_assessment_email", {
      p_id: row.id,
      p_claim: row.claim_token,
      p_sent: delivered,
    });
    if (result.error || result.data !== true)
      throw Error("Assessment email result not recorded.");
    if (delivered) sent++;
    else failed++;
  }
  return { sent, failed, configured: true };
}
