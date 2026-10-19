import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountMailReady,
  sendPrivateAccountMail,
} from "@/lib/privateAccountMail";
import { securityMailRecipientAllowed } from "@/lib/accountSecurityAlerts";
import { chatMessageMail, chatMessageSite } from "@/lib/chatMessageMail";

export async function deliverChatMessageEmails(admin: SupabaseClient) {
  const site = chatMessageSite(process.env);
  if (!accountMailReady() || !site)
    throw new Error("Chat email is not configured");
  const claimed = await admin.rpc("claim_chat_message_emails", { p_limit: 2 });
  if (claimed.error) throw new Error("Chat emails could not be claimed");
  let sent = 0,
    cancelled = 0,
    failed = 0;
  for (const row of claimed.data ?? []) {
    let outcome = "retry";
    try {
      const allowed = securityMailRecipientAllowed(row.email, process.env);
      const fresh = await admin.rpc("chat_message_email_allowed", {
        p_id: row.id,
        p_token: row.claim_token,
        p_email: row.email,
      });
      if (fresh.error) throw new Error("Eligibility check unavailable");
      if (!allowed || !fresh.data) {
        outcome = "cancelled";
        cancelled++;
      } else {
        const mail = chatMessageMail(row, site);
        if (
          await sendPrivateAccountMail(
            row.email,
            mail.subject,
            mail.text,
            `chat-message:${row.id}`,
          )
        ) {
          outcome = "sent";
          sent++;
        } else failed++;
      }
    } catch {
      failed++;
    }
    const saved = await admin.rpc("finish_chat_message_email", {
      p_id: row.id,
      p_token: row.claim_token,
      p_outcome: outcome,
    });
    if (saved.error) throw new Error("Chat email outcome could not be saved");
    await new Promise((resolve) => setTimeout(resolve, 550));
  }
  return { sent, cancelled, failed };
}
