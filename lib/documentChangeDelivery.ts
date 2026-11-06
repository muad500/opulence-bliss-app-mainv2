import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountMailReady, sendPrivateAccountMail } from "./privateAccountMail";
import { securityMailRecipientAllowed } from "./accountSecurityAlerts";
import { documentChangeMail } from "./documentChangePolicy";
import { deploymentOrigins } from "./adminHosts";
export async function deliverDocumentChangeEmails(admin: SupabaseClient) {
  const claim = await admin.rpc("claim_document_change_emails", { p_limit: 4 });
  if (claim.error) throw Error("Document notices could not be claimed.");
  let sent = 0,
    failed = 0;
  for (const row of claim.data ?? []) {
    const allowed = securityMailRecipientAllowed(row.recipient, process.env);
    const origin = deploymentOrigins(process.env).website;
    const delivered =
      allowed &&
      accountMailReady() &&
      (await sendPrivateAccountMail(
        row.recipient,
        `Changes to ${row.title}`,
        documentChangeMail(
          row,
          `${origin}/account/document-changes/${row.plan_id}`,
        ),
        `document-change:${row.plan_id}:${row.user_id}`,
      ));
    const finish = await admin.rpc("finish_document_change_email", {
      p_plan: row.plan_id,
      p_user: row.user_id,
      p_token: row.claim_token,
      p_sent: delivered,
      p_error: !allowed
        ? "Staging recipient is not authorised"
        : "Delivery not confirmed",
    });
    if (finish.error || finish.data !== true)
      throw Error("Document notice delivery result could not be saved.");
    if (delivered) sent++;
    else failed++;
    await new Promise((resolve) => setTimeout(resolve, 550));
  }
  return { sent, failed };
}
