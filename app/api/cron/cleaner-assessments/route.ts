import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { deliverCleanerAssessmentDecisions } from "@/lib/cleanerAssessmentDelivery";
import { deliverCleanerOnboardingEmails } from "@/lib/cleanerOnboardingMail";
import { cleanerSetupPayoutAccount } from "@/lib/cleanerSetupStripe";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!cleanerStage2Enabled())
    return Response.json({ error: "Not found" }, { status: 404, headers });
  const sent = Buffer.from(request.headers.get("authorization") ?? "");
  const allowed = [process.env.CRON_SECRET].filter(
    (value): value is string => !!value,
  );
  const configured = allowed.some((secret) => {
    const expected = Buffer.from(`Bearer ${secret}`);
    return sent.length === expected.length && timingSafeEqual(sent, expected);
  });
  const proof = (request.headers.get("authorization") ?? "").match(
    /^Bearer ([a-f0-9]{64})$/,
  )?.[1];
  if (!configured && !proof)
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  let step = "authorization";
  let code: string | undefined;
  let diagnostic: string | undefined;
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (!configured) {
      const verified = await admin.rpc("cleaner_stage2_scheduler_authorized", {
        p_token: proof,
      });
      if (verified.error || verified.data !== true)
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers },
        );
    }
    step = "assessment-recovery";
    const { data, error } = await admin.rpc("sweep_cleaner_assessments");
    if (error) {
      code = /^[A-Z0-9]{3,12}$/.test(error.code ?? "") ? error.code : undefined;
      if (code === "21000") diagnostic = String(error.message).slice(0, 220);
      throw Error("Recovery unavailable");
    }
    step = "payout-rechecks";
    const checks = await admin.rpc("cleaner_stage2_payout_rechecks");
    if (checks.error || !Array.isArray(checks.data))
      throw Error("Payout verification unavailable");
    let checked = 0;
    for (const item of checks.data) {
      try {
        const account = await cleanerSetupPayoutAccount(
          admin,
          item.provider_id,
          item.profile_id,
        );
        const recorded = await admin.rpc("record_cleaner_stage2_payout_check", {
          p_application: item.id,
          p_ready: account.ready,
        });
        if (!recorded.error) checked++;
      } catch {
        /* An upstream outage is not evidence that a check failed. Stale checks block new offers. */
      }
    }
    step = "followups";
    const followups = await admin.rpc("process_cleaner_stage2_followups");
    if (followups.error) throw Error("Follow-ups unavailable");
    step = "retention";
    const cleanup = await admin.rpc("purge_expired_cleaner_applications");
    if (cleanup.error) throw Error("Retention unavailable");
    step = "assessment-mail";
    const decisions = await deliverCleanerAssessmentDecisions(admin);
    step = "onboarding-mail";
    const onboarding = await deliverCleanerOnboardingEmails(admin);
    return Response.json(
      {
        processed: data,
        payoutChecks: checked,
        followups: followups.data,
        retention: cleanup.data,
        decisions,
        onboarding,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Assessment recovery unavailable", step, code, diagnostic },
      { status: 503, headers },
    );
  }
}
