import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handymanEnabled } from "./handymanMarketplace";
import { reviewHandymanQuoteDispute } from "./handymanQuoteServer";

export function isHandymanPayment(kind: string | undefined) {
  return kind === "handyman" || kind === "handyman_quote";
}

/** Classify with Stripe before querying the optional marketplace tables.
 * Cleaning disputes must not depend on the handyman migration being installed.
 * Relevant failures still propagate so Stripe retries instead of losing a case.
 */
export async function handleHandymanDispute(
  admin: SupabaseClient,
  stripe: Stripe,
  dispute: Stripe.Dispute,
) {
  if (!handymanEnabled() || dispute.livemode) return;
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;
  const charge = await stripe.charges.retrieve(chargeId, {
    expand: ["payment_intent"],
  });
  const intent = charge.payment_intent;
  const kind =
    typeof intent === "object" && intent
      ? intent.metadata.kind
      : charge.metadata.kind;
  if (charge.livemode || kind !== "handyman_quote") return;
  await reviewHandymanQuoteDispute(admin, charge.id);
}
