"use server";

import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { canUseProfessionalTools } from "@/lib/professionalAccess";

export type PayoutScheduleState = { ok: boolean; message: string };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function savePayoutSchedule(
  _previous: PayoutScheduleState,
  formData: FormData,
): Promise<PayoutScheduleState> {
  const schedule = String(formData.get("schedule") ?? "");
  if (!["weekly", "fortnightly", "monthly"].includes(schedule)) {
    return { ok: false, message: "Choose a valid payment schedule." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in again." };

  const { data: provider } = await admin
    .from("providers")
    .select(
      "id, stripe_account_id, is_suspended, vetting_status, service_approvals",
    )
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!provider) return { ok: false, message: "Provider account not found." };
  if (!canUseProfessionalTools(provider))
    return {
      ok: false,
      message:
        "Payout settings unlock after your professional application is approved.",
    };
  if (provider.is_suspended) {
    return {
      ok: false,
      message: "Payment settings cannot change while the account is suspended.",
    };
  }

  try {
    if (provider.stripe_account_id) {
      await stripe.accounts.update(provider.stripe_account_id, {
        settings: {
          payouts: {
            schedule:
              schedule === "weekly"
                ? { interval: "weekly", weekly_anchor: "monday" }
                : schedule === "monthly"
                  ? { interval: "monthly", monthly_anchor: 1 }
                  : { interval: "manual" },
          },
        },
      });
    }

    const nextPayout =
      schedule === "fortnightly"
        ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        : null;
    const { error } = await admin
      .from("providers")
      .update({
        payout_schedule: schedule,
        payout_schedule_updated_at: new Date().toISOString(),
        payout_anchor_date: new Date().toISOString().slice(0, 10),
        next_payout_at: nextPayout,
      })
      .eq("id", provider.id);
    if (error) throw new Error(error.message);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Could not update the payment schedule: ${error.message}`
          : "Could not update the payment schedule.",
    };
  }

  revalidatePath("/worker/earnings");
  return {
    ok: true,
    message: !provider.stripe_account_id
      ? "Saved. This schedule will start when your Stripe payout account is connected."
      : schedule === "fortnightly"
        ? "Saved. Available Stripe balance will be paid every 2 weeks."
        : `Saved. Stripe will pay available balance ${schedule}.`,
  };
}
