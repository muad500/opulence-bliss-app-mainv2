import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanerStage2Enabled } from "./cleanerApplication";
export function cleanerSetupStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!cleanerStage2Enabled() || !key?.startsWith("sk_test_"))
    throw Error("Isolated Stripe test setup required.");
  return new Stripe(key);
}
export async function cleanerSetupPayoutAccount(
  admin: SupabaseClient,
  provider: string,
  user: string,
  create = false,
) {
  const result = await admin
    .from("providers")
    .select("stripe_account_id")
    .eq("id", provider)
    .eq("profile_id", user)
    .single();
  if (result.error) throw Error("Own professional account required.");
  const stripe = cleanerSetupStripe();
  let id = result.data.stripe_account_id;
  if (!id && create) {
    const account = await stripe.v2.core.accounts.create(
      {
        dashboard: "express",
        identity: { country: "GB" },
        defaults: {
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
        metadata: { opulence_provider_id: provider },
        include: ["configuration.recipient", "requirements"],
      },
      { idempotencyKey: `cleaner-stage2-connect:${provider}` },
    );
    if (account.livemode) throw Error("Live accounts are refused.");
    const saved = await admin
      .from("providers")
      .update({ stripe_account_id: account.id })
      .eq("id", provider)
      .eq("profile_id", user)
      .is("stripe_account_id", null)
      .select("stripe_account_id")
      .maybeSingle();
    if (saved.error) throw Error("Payout setup could not be recorded.");
    if (saved.data) id = saved.data.stripe_account_id;
    else {
      const current = await admin
        .from("providers")
        .select("stripe_account_id")
        .eq("id", provider)
        .single();
      if (current.error || current.data?.stripe_account_id !== account.id)
        throw Error("Payout setup changed; retry.");
      id = account.id;
    }
  }
  const account = id
    ? await stripe.v2.core.accounts.retrieve(id, {
        include: ["configuration.recipient", "requirements"],
      })
    : null;
  if (
    account &&
    (account.livemode || account.metadata?.opulence_provider_id !== provider)
  )
    throw Error("This is not the assigned cleaner's own Stage 2 test account.");
  return {
    stripe,
    account,
    ready:
      account?.configuration?.recipient?.capabilities?.stripe_balance
        ?.stripe_transfers?.status === "active",
  };
}
