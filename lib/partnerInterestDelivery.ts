import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountMailReady, sendPrivateAccountMail } from "./privateAccountMail";
import { securityMailRecipientAllowed } from "./accountSecurityAlerts";
import { PARTNER_INTEREST_THANK_YOU } from "./partnerInterestCopy";

export async function deliverPartnerInterestEmails(
  admin: SupabaseClient,
  interestId?: string,
) {
  if (!accountMailReady())
    return { configured: false, sent: 0, failed: 0, held: 0 };
  const claim = await admin.rpc("claim_partner_interest_emails", {
    p_limit: interestId ? 1 : 2,
    p_interest: interestId ?? null,
  });
  if (claim.error)
    throw new Error("Partner confirmation queue is unavailable.");
  let sent = 0,
    failed = 0,
    held = 0;
  for (const row of claim.data ?? []) {
    let outcome = "retry";
    if (!securityMailRecipientAllowed(row.email, process.env)) {
      outcome = "held";
      held++;
    } else {
      const delivered = await sendPrivateAccountMail(
        row.email,
        PARTNER_INTEREST_THANK_YOU.title,
        `${PARTNER_INTEREST_THANK_YOU.title}\n\n${PARTNER_INTEREST_THANK_YOU.body}\n\n${PARTNER_INTEREST_THANK_YOU.inbox}`,
        `partner-interest:${row.interest_id}`,
      );
      if (delivered) {
        sent++;
        outcome = "sent";
      } else failed++;
    }
    const finish = await admin.rpc("finish_partner_interest_email", {
      p_id: row.id,
      p_token: row.claim_token,
      p_outcome: outcome,
    });
    if (finish.error)
      throw new Error("Partner confirmation result could not be saved.");
    if (!interestId) await new Promise((resolve) => setTimeout(resolve, 550));
  }
  return { configured: true, sent, failed, held };
}
