import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import {
  accountContext,
  isAccountError,
  normaliseGbPhone,
} from "@/lib/accountApi";
import {
  prepareAccountAcceptance,
  saveAccountAcceptance,
} from "@/lib/accountAcceptanceServer";
import {
  professionalConsentBoxes,
  validProfessionalConsent,
} from "@/lib/professionalLegalCopy";
import { cleanerSetupPayoutAccount } from "@/lib/cleanerSetupStripe";
import { onboardingPreviewOrigin } from "@/lib/cleanerOnboardingMail";
const headers = { "Cache-Control": "private, no-store" };
async function ownSetup() {
  const client = await createClient();
  return client.rpc("own_cleaner_stage2_setup");
}
export async function GET(request: NextRequest) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const ctx = await accountContext(request, { provider: true });
  if (isAccountError(ctx)) return ctx;
  const state = await ownSetup();
  if (state.error || state.data?.providerId !== ctx.providerId)
    return NextResponse.json(
      { error: "Passed applicant account required." },
      { status: 403, headers },
    );
  try {
    const payout = await cleanerSetupPayoutAccount(
      ctx.admin,
      ctx.providerId!,
      ctx.user.id,
    );
    return NextResponse.json(
      { ...state.data, payoutReady: payout.ready },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { ...state.data, payoutReady: false, payoutUnavailable: true },
      { headers },
    );
  }
}
export async function POST(request: NextRequest) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const ctx = await accountContext(request, { provider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  const state = await ownSetup();
  if (
    state.error ||
    state.data?.providerId !== ctx.providerId ||
    !["assessment_passed", "accepted_setup"].includes(state.data.status)
  )
    return NextResponse.json(
      { error: "Use your own passed applicant account." },
      { status: 403, headers },
    );
  try {
    const text = await request.text();
    if (text.length > 12000) throw Error();
    const input = JSON.parse(text);
    if (input.action === "payout") {
      const payout = await cleanerSetupPayoutAccount(
        ctx.admin,
        ctx.providerId!,
        ctx.user.id,
        true,
      );
      const origin = onboardingPreviewOrigin();
      const link = await payout.stripe.v2.core.accountLinks.create({
        account: payout.account!.id,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["recipient"],
            refresh_url: `${origin}/cleaner-setup?stripe=refresh`,
            return_url: `${origin}/cleaner-setup?stripe=returned`,
          },
        },
      });
      if (link.livemode) throw Error();
      return NextResponse.json({ url: link.url }, { headers });
    }
    if (
      input.action !== "accept" ||
      !validProfessionalConsent(input.consents, true, false)
    )
      return NextResponse.json(
        { error: "Read and tick every required agreement." },
        { status: 400, headers },
      );
    const name = String(input.emergencyName ?? "").trim(),
      relationship = String(input.emergencyRelationship ?? "").trim();
    const phone = normaliseGbPhone(input.emergencyPhone);
    if (
      !name ||
      name.length > 150 ||
      !relationship ||
      relationship.length > 120 ||
      !phone ||
      !["weekly", "fortnightly", "monthly"].includes(input.schedule)
    )
      return NextResponse.json(
        {
          error: "Complete the emergency contact and choose a payout schedule.",
        },
        { status: 400, headers },
      );
    const payout = await cleanerSetupPayoutAccount(
      ctx.admin,
      ctx.providerId!,
      ctx.user.id,
    );
    if (!payout.ready || !payout.account)
      return NextResponse.json(
        {
          error:
            "Complete your own Stripe test payout setup before continuing.",
        },
        { status: 409, headers },
      );
    const evidence = await prepareAccountAcceptance(
      ctx.admin,
      [
        "cleaner-terms",
        "cleaner-cancellation",
        "privacy",
        "safeguarding",
        "dbs-data",
      ],
      request.headers,
      professionalConsentBoxes(true, false).map((box) => ({
        ...box,
        checked: true as const,
      })),
    );
    await saveAccountAcceptance(ctx.admin, ctx.user.id, evidence);
    const accepted = await ctx.admin.rpc("record_cleaner_stage2_acceptances", {
      p_user: ctx.user.id,
      p_evidence: evidence,
    });
    if (accepted.error) throw Error();
    const settings = await ctx.admin.from("provider_profile_settings").upsert(
      {
        provider_id: ctx.providerId,
        emergency_contact_name: name,
        emergency_contact_relationship: relationship,
        emergency_contact_phone: phone,
      },
      { onConflict: "provider_id" },
    );
    if (settings.error) throw Error();
    // Initial preference only, using the existing schedule conventions. No
    // payout, transfer, balance or booked pay is created or changed here.
    await payout.stripe.accounts.update(payout.account.id, {
      settings: {
        payouts: {
          schedule:
            input.schedule === "weekly"
              ? { interval: "weekly", weekly_anchor: "monday" }
              : input.schedule === "monthly"
                ? { interval: "monthly", monthly_anchor: 1 }
                : { interval: "manual" },
        },
      },
    });
    const schedule = await ctx.admin
      .from("providers")
      .update({
        payout_schedule: input.schedule,
        payout_schedule_updated_at: new Date().toISOString(),
        payout_anchor_date: new Date().toISOString().slice(0, 10),
        next_payout_at:
          input.schedule === "fortnightly"
            ? new Date(Date.now() + 14 * 86400000).toISOString()
            : null,
      })
      .eq("id", ctx.providerId);
    if (schedule.error) throw Error();
    const completed = await ctx.admin.rpc("complete_cleaner_stage2_setup", {
      p_user: ctx.user.id,
      p_payout: payout.account.id,
    });
    if (completed.error) throw Error();
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Setup could not be completed. Your checks and assessment result are unchanged; retry or contact support.",
      },
      { status: 503, headers },
    );
  }
}
