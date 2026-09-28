import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  claimMoneyOperation,
  maybeReleasePayout,
  systemFinaliseMoneyOperation,
  systemTransitionPayout,
} from "@/lib/bookingState";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** Transfer one visit's allocated share of an upfront payment after completion. */
export async function settlePrepaidVisit(bookingId: string) {
  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("id, status, regular_series_id, provider_id")
    .eq("id", bookingId)
    .single();
  if (bookingError || !booking?.regular_series_id || booking.status !== "completed" || !booking.provider_id) {
    throw new Error("A completed, assigned regular booking is required for payout.");
  }

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id, stripe_payment_ref, status, split_breakdown")
    .eq("booking_id", bookingId)
    .or("kind.is.null,kind.neq.tip")
    .limit(1)
    .single();
  const split = payment?.split_breakdown as { provider?: number; upfront_series_id?: string } | null;
  const amountPence = Math.round(Number(split?.provider ?? 0) * 100);
  if (paymentError || !payment?.stripe_payment_ref || payment.status !== "succeeded" ||
      split?.upfront_series_id !== booking.regular_series_id || !Number.isInteger(amountPence) || amountPence <= 0) {
    throw new Error("The upfront payment for this visit is not settled.");
  }

  let { data: payout } = await admin.from("payouts")
    .select("id, status, stripe_transfer_ref")
    .eq("booking_id", bookingId)
    .limit(1)
    .maybeSingle();
  if (!payout) {
    const { data: created, error } = await admin.from("payouts")
      .insert({
        provider_id: booking.provider_id,
        booking_id: bookingId,
        amount: amountPence / 100,
        status: "not_ready",
      })
      .select("id, status, stripe_transfer_ref")
      .single();
    if (error) throw new Error(error.message);
    payout = created;
  }

  if (payout.status === "paid" && payout.stripe_transfer_ref) {
    return { earned: amountPence / 100, payoutSettled: true };
  }
  if (payout.status === "not_ready") {
    await maybeReleasePayout(admin, bookingId);
    const { data: refreshed, error } = await admin.from("payouts")
      .select("id, status, stripe_transfer_ref").eq("id", payout.id).single();
    if (error) throw new Error(error.message);
    payout = refreshed;
  }
  if (payout.status !== "pending") {
    return { earned: amountPence / 100, payoutSettled: false };
  }

  const operationKey = `transfer:booking:${bookingId}:provider:${booking.provider_id}`;
  const operation = await claimMoneyOperation(admin, {
    operationKey,
    operationType: "transfer",
    bookingId,
    amount: amountPence / 100,
  });
  if (operation.status === "succeeded") {
    if (!operation.stripe_object_id) {
      throw new Error("Completed transfer is missing its Stripe reference.");
    }
    const { error } = await admin.from("payouts")
      .update({ stripe_transfer_ref: operation.stripe_object_id })
      .eq("id", payout.id);
    if (error) throw new Error(error.message);
    await systemTransitionPayout(admin, payout.id, "processing");
    await systemTransitionPayout(admin, payout.id, "paid");
    return { earned: amountPence / 100, payoutSettled: true };
  }
  if (!operation.should_run) {
    return { earned: amountPence / 100, payoutSettled: false };
  }

  const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_ref);
  if (intent.status !== "succeeded" || intent.metadata.upfront_regular !== "1" || !intent.latest_charge) {
    await systemFinaliseMoneyOperation(admin, operation.id, "failed", { error: "Upfront Stripe charge is not settled." });
    await systemTransitionPayout(admin, payout.id, "held", { reason: "Upfront Stripe charge requires review" });
    await admin.rpc("open_review_case", {
      p_booking_id: bookingId, p_category: "payment_failure", p_priority: "high",
      p_blocks_payment: true, p_blocks_payout: true,
      p_notes: "Upfront Stripe charge is not settled for a completed visit.", p_created_by: null,
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }
  const { data: provider } = await admin.from("providers")
    .select("stripe_account_id").eq("id", booking.provider_id).maybeSingle();
  const destination = provider?.stripe_account_id ?? (intent.livemode ? null : process.env.PROVIDER_TEST_ACCOUNT);
  if (!destination) {
    await systemFinaliseMoneyOperation(admin, operation.id, "failed", { error: "Provider Stripe account is missing." });
    await systemTransitionPayout(admin, payout.id, "held", { reason: "Provider payout account is not configured" });
    await admin.rpc("open_review_case", {
      p_booking_id: bookingId, p_category: "payment_failure", p_priority: "high",
      p_blocks_payment: false, p_blocks_payout: true,
      p_notes: "Provider Stripe account is missing for a prepaid visit payout.", p_created_by: null,
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }

  await systemTransitionPayout(admin, payout.id, "processing");
  try {
    const transfer = await stripe.transfers.create({
      amount: amountPence,
      currency: "gbp",
      destination,
      source_transaction: typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge.id,
      transfer_group: intent.transfer_group ?? undefined,
      metadata: { booking_id: bookingId, kind: "regular_visit", operation_key: operationKey },
    }, { idempotencyKey: operationKey });
    await systemFinaliseMoneyOperation(admin, operation.id, "succeeded", { stripeObjectId: transfer.id });
    const { error } = await admin.from("payouts").update({ stripe_transfer_ref: transfer.id }).eq("id", payout.id);
    if (error) throw new Error(error.message);
    await systemTransitionPayout(admin, payout.id, "paid");
    return { earned: amountPence / 100, payoutSettled: true };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Regular visit transfer failed";
    const definite = cause instanceof Stripe.errors.StripeInvalidRequestError;
    await systemFinaliseMoneyOperation(admin, operation.id, definite ? "failed" : "ambiguous", { error: reason }).catch(() => undefined);
    if (definite) await systemTransitionPayout(admin, payout.id, "failed", { reason });
    await admin.rpc("open_review_case", {
      p_booking_id: bookingId,
      p_category: "payout_failure",
      p_priority: "high",
      p_blocks_payment: false,
      p_blocks_payout: true,
      p_notes: `Prepaid visit transfer needs review: ${reason}`,
      p_created_by: null,
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }
}
