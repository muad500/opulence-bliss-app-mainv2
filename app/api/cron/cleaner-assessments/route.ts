import { timingSafeEqual, createHmac } from "node:crypto";
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
  // The staging Edge worker derives this from the same project's existing
  // server credential. No new persistent secret or Production key is needed.
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY)
        .update("opulence/staging/cleaner-stage2-scheduler/v1")
        .digest("hex")
    : null;
  const allowed = [process.env.CRON_SECRET, derived].filter(
    (value): value is string => !!value,
  );
  if (
    !allowed.some((secret) => {
      const expected = Buffer.from(`Bearer ${secret}`);
      return sent.length === expected.length && timingSafeEqual(sent, expected);
    })
  )
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await admin.rpc("sweep_cleaner_assessments");
    if (error) throw Error("Recovery unavailable");
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
    const followups = await admin.rpc("process_cleaner_stage2_followups");
    if (followups.error) throw Error("Follow-ups unavailable");
    const cleanup = await admin.rpc("purge_expired_cleaner_applications");
    if (cleanup.error) throw Error("Retention unavailable");
    const decisions = await deliverCleanerAssessmentDecisions(admin);
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
      { error: "Assessment recovery unavailable" },
      { status: 503, headers },
    );
  }
}
