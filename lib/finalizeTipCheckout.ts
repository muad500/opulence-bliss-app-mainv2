import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { settleTipPayout } from "@/lib/tipPayout";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Shared by the verified webhook and the signed-in customer's return path. */
export async function finalizeTipCheckout(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent) {
  const bookingId = intent.metadata.booking_id;
  if (session.mode !== "payment" || session.payment_status !== "paid" ||
      intent.status !== "succeeded" || intent.metadata.kind !== "tip" ||
      !bookingId || !session.client_reference_id || intent.currency !== "gbp" ||
      intent.amount <= 0) {
    throw new Error("Tip checkout is not a completed customer payment.");
  }
  const { data: booking, error: bookingError } = await admin.from("bookings")
    .select("id, customer_id, provider_id, status")
    .eq("id", bookingId).single();
  if (bookingError || !booking || booking.customer_id !== session.client_reference_id ||
      booking.status !== "completed" || !booking.provider_id) {
    throw new Error("Tip checkout does not belong to a completed customer booking.");
  }

  const found = await admin.from("payments")
    .select("id").eq("stripe_payment_ref", intent.id).eq("kind", "tip").maybeSingle();
  if (found.error) throw new Error(found.error.message);
  let payment = found.data;
  if (!payment) {
    const created = await admin.from("payments").insert({
      booking_id: bookingId,
      kind: "tip",
      gross_amount: intent.amount / 100,
      split_breakdown: { provider: intent.amount / 100 },
      stripe_payment_ref: intent.id,
      status: "succeeded",
    }).select("id").single();
    if (created.error) {
      // Webhook and browser may race. Re-read the payment rather than duplicate it.
      const retry = await admin.from("payments").select("id")
        .eq("stripe_payment_ref", intent.id).eq("kind", "tip").single();
      if (retry.error) throw new Error(created.error.message);
      payment = retry.data;
    } else {
      payment = created.data;
      const { data: provider } = await admin.from("providers")
        .select("profile_id").eq("id", booking.provider_id).maybeSingle();
      if (provider?.profile_id) {
        await admin.from("notifications").insert({
          user_id: provider.profile_id,
          title: `You received a £${(intent.amount / 100).toFixed(2)} tip`,
          body: "A client added a tip for your completed visit. Payout status is in Earnings.",
          href: "/worker/earnings",
        });
      }
    }
  }
  const result = await settleTipPayout(payment.id);
  return { paymentId: payment.id, payoutSettled: result.payoutSettled };
}
