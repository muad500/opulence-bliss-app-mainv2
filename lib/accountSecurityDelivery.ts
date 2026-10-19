import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountMailReady,
  sendPrivateAccountMail,
} from "@/lib/privateAccountMail";
import {
  ACCOUNT_CHANGE_MESSAGE,
  ACCOUNT_CHANGE_SUBJECT,
  securityMailRecipientAllowed,
} from "@/lib/accountSecurityAlerts";

export async function deliverAccountSecurityAlerts(admin: SupabaseClient) {
  if (!accountMailReady())
    throw new Error("Account security email is not configured");
  // Keep exhausted/expired rows visible rather than silently abandoning them.
  const expired = await admin
    .from("account_security_alerts")
    .update({
      status: "failed",
      last_error: "Delivery requires administrator review",
    })
    .in("status", ["pending", "processing"])
    .or(
      `attempts.gte.12,created_at.lt.${new Date(Date.now() - 23 * 3600000).toISOString()}`,
    )
    .or(`leased_until.is.null,leased_until.lt.${new Date().toISOString()}`);
  if (expired.error) throw new Error("Security alert maintenance failed");
  const claimed = await admin.rpc("claim_account_security_alerts", {
    p_limit: 4,
  });
  if (claimed.error) throw new Error("Security alerts could not be claimed");
  let sent = 0,
    held = 0;
  for (const row of claimed.data ?? []) {
    const allowed = securityMailRecipientAllowed(row.recipient, process.env);
    const delivered =
      allowed &&
      (await sendPrivateAccountMail(
        row.recipient,
        ACCOUNT_CHANGE_SUBJECT,
        ACCOUNT_CHANGE_MESSAGE,
        `account-security:${row.id}`,
      ));
    const update = await admin
      .from("account_security_alerts")
      .update(
        delivered
          ? {
              status: "sent",
              sent_at: new Date().toISOString(),
              leased_until: null,
              last_error: null,
            }
          : {
              status: !allowed || row.attempts >= 12 ? "failed" : "pending",
              leased_until: null,
              next_attempt_at: new Date(
                Date.now() + Math.min(3600000, 60000 * 2 ** row.attempts),
              ).toISOString(),
              last_error: allowed
                ? "Email delivery could not be confirmed"
                : "Staging recipient is not authorised",
            },
      )
      .eq("id", row.id)
      .eq("claim_token", row.claim_token)
      .eq("status", "processing");
    if (update.error)
      throw new Error("Security alert result could not be saved");
    if (delivered) sent++;
    else held++;
    // Resend's default rate limit is two requests/second. Batches are bounded.
    await new Promise((resolve) => setTimeout(resolve, 550));
  }
  return { sent, held };
}
