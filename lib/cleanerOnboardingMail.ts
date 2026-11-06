import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanerStage2Enabled } from "./cleanerApplication";
import { cleanerOnboardingDraftCatalog } from "./cleanerOnboardingDraftsServer";
import { onboardingAccess } from "./cleanerOnboardingAccess";
import { launchOperationsPayload } from "./launchOperationsMail";

export function onboardingPreviewOrigin(env = process.env) {
  const host = env.VERCEL_BRANCH_URL;
  if (
    !cleanerStage2Enabled(env) ||
    !host ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(host) ||
    !env.VERCEL_URL ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL)
  )
    throw Error("Isolated Preview origin required.");
  return `https://${host}`;
}

export function renderApprovedOnboardingEmail(
  id: string,
  fields: Record<string, string>,
) {
  const catalog = cleanerOnboardingDraftCatalog();
  const template = catalog.emails.find((item) => item.id === id);
  if (catalog.status !== "approved" || !catalog.approval || !template?.approval)
    throw Error("Approved onboarding wording unavailable.");
  const merge = (text: string) =>
    text.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => {
      if (typeof fields[key] !== "string" || !fields[key].trim())
        throw Error("Required email field unavailable.");
      return fields[key];
    });
  return {
    subject: `[STAGING TEST] ${merge(template.subject)}`,
    text: template.paragraphs.map(merge).join("\n\n"),
  };
}

/** A staging-only leased outbox. Never sends to an applicant-supplied address
 * unless it is the one owner-approved test inbox; fictional .invalid fixtures
 * are redirected to that same inbox. Stable payload/key survive retries. */
export async function deliverCleanerOnboardingEmails(admin: SupabaseClient) {
  const env = process.env;
  const recipients = [
    ...new Set(
      (env.STAGING_EMAIL_RECIPIENTS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const sender =
    env.ACCOUNT_EMAIL_FROM ?? env.BOOKING_EMAIL_FROM ?? env.EMAIL_FROM;
  if (
    !cleanerStage2Enabled() ||
    !env.RESEND_API_KEY ||
    recipients.length !== 1 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipients[0]) ||
    !sender ||
    !/(?:^|<)staging@opulencebliss\.com>?$/i.test(sender)
  )
    return { configured: false, sent: 0, failed: 0 };
  const origin = onboardingPreviewOrigin();
  const queue = await admin.rpc("claim_cleaner_onboarding_emails", {
    p_allowed: recipients,
  });
  if (queue.error || !Array.isArray(queue.data))
    throw Error("Onboarding queue unavailable.");
  let sent = 0,
    failed = 0;
  for (const row of queue.data) {
    let delivered = false;
    try {
      if (row.email !== recipients[0] || row.wording_version !== "1.0")
        throw Error("Recipient/version refused.");
      if (
        row.template_key === "dbsDecisionNotice" &&
        env.CLEANER_SECURE_DBS_DECISIONS_ENABLED !== "true"
      )
        throw Error("Secure decision delivery disabled.");
      let payload = row.delivery_payload;
      if (!payload) {
        const fields: Record<string, string> = {
          ...row.context,
          first_name: String(row.full_name).trim().split(/\s+/)[0],
          application_reference: row.application_id,
          professional_reference: row.application_id,
          privacy_url: `${origin}/legal/privacy`,
          dbs_policy_url: `${origin}/provider/join/policies/dbs-data`,
          staff_record_url: `https://${env.VERCEL_URL}/admin/cleaner-applications`,
          account_url: `${origin}/worker/profile`,
        };
        if (row.template_key === "dbsDecisionNotice") {
          const token = onboardingAccess(
            row.application_id,
            "decision",
            row.context.expiresAt,
          );
          fields.secure_decision_url = `${origin}/cleaner-decision#access=${token}`;
        }
        if (row.template_key === "inductionInvitation") {
          const token = onboardingAccess(
            row.application_id,
            "induction",
            row.context.invitation_expires_at,
          );
          fields.assessment_invitation_url = `${origin}/cleaner-assessment#invitation=${token}`;
        }
        payload = {
          from: sender,
          to: recipients,
          reply_to: "hello@opulencebliss.com",
          ...renderApprovedOnboardingEmail(row.template_key, fields),
        };
        if (row.template_key === "stage2Welcome") {
          const accepted = await launchOperationsPayload(
            "welcome",
            {
              firstName: fields.first_name,
              documents: row.context.documents,
              acceptedAt: row.context.acceptedAt,
              handyman: false,
            },
            recipients[0],
            sender,
            origin,
          );
          payload.attachments = accepted.attachments;
        }
        const saved = await admin.rpc("prepare_cleaner_onboarding_email", {
          p_id: row.id,
          p_claim: row.claim_token,
          p_payload: payload,
        });
        if (saved.error || !saved.data)
          throw Error("Email preparation failed.");
        payload = saved.data;
      }
      if (
        payload.to?.length !== 1 ||
        payload.to[0] !== recipients[0] ||
        payload.from !== sender
      )
        throw Error("Frozen recipient/sender refused.");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `cleaner-onboarding:${row.id}:${row.context.decisionId ?? "1"}`,
        },
        body: JSON.stringify(payload),
      });
      delivered = response.ok;
    } catch {
      /* No body, link, address or provider response in scheduler logs. */
    }
    const saved = await admin.rpc("finish_cleaner_onboarding_email", {
      p_id: row.id,
      p_claim: row.claim_token,
      p_sent: delivered,
    });
    if (saved.error || saved.data !== true)
      throw Error("Email result not recorded.");
    if (delivered) sent++;
    else failed++;
  }
  return { configured: true, sent, failed };
}
