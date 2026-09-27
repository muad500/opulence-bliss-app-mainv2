import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  claimMoneyOperation,
  systemFinaliseMoneyOperation,
  systemTransitionPayout,
} from "@/lib/bookingState";
import { payoutDestination } from "@/lib/payoutDestination";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** Transfer the assigned cleaner's share after a completed, captured visit. */
export async function settleCompletedVisitPayout(bookingId: string, requestedBy?: string) {
  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("id, status, regular_series_id, subscription_id, provider_id")
    .eq("id", bookingId)
    .single();
  if (bookingError || !booking || booking.subscription_id || booking.status !== "completed" || !booking.provider_id) {
    throw new Error("A completed, assigned per-visit booking is required for payout.");
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
      (booking.regular_series_id ? split?.upfront_series_id !== booking.regular_series_id : Boolean(split?.upfront_series_id)) ||
      !Number.isInteger(amountPence) || amountPence <= 0) {
    throw new Error("The captured payment for this visit is not settled.");
  }

  let { data: payout } = await admin.from("payouts")
    .select("id, status, amount, stripe_transfer_ref")
    .eq("booking_id", bookingId)
    .is("payment_id", null)
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
      .select("id, status, amount, stripe_transfer_ref")
      .single();
    if (error) throw new Error(error.message);
    payout = created;
  }

  if (payout.status === "paid" && payout.stripe_transfer_ref) {
    return { earned: amountPence / 100, payoutSettled: true };
  }
  if (payout.status === "not_ready") {
    // The legacy booking-wide release can select a tip row instead. Use the
    // visit-only database primitive for a booking with more than one payout.
    const { error: releaseError } = await admin.rpc("maybe_release_visit_payout", {
      p_booking_id: bookingId,
    });
    if (releaseError) throw new Error(releaseError.message);
    const { data: refreshed, error } = await admin.from("payouts")
      .select("id, status, amount, stripe_transfer_ref").eq("id", payout.id).single();
    if (error) throw new Error(error.message);
    payout = refreshed;
  }
  if (!["pending", "processing", "failed"].includes(payout.status)) {
    return { earned: amountPence / 100, payoutSettled: false };
  }
  if (Math.round(Number(payout.amount) * 100) !== amountPence) {
    const reason = "Visit payout amount differs from the captured payment allocation";
    if (payout.status !== "processing") {
      await systemTransitionPayout(admin, payout.id, "held", { reason });
    }
    await admin.rpc("open_review_case", {
      p_booking_id: bookingId, p_category: "payout_failure", p_priority: "high",
      p_blocks_payment: false, p_blocks_payout: true,
      p_notes: reason, p_created_by: requestedBy ?? null,
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }

  const { count: blockingCases, error: caseError } = await admin.from("review_cases")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", bookingId)
    .neq("status", "resolved")
    .or("blocks_payment.eq.true,blocks_payout.eq.true");
  if (caseError) throw new Error(caseError.message);
  if ((blockingCases ?? 0) > 0 && ["pending", "failed"].includes(payout.status)) {
    await systemTransitionPayout(admin, payout.id, "held", {
      reason: "An open review case blocks this payout",
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }

  const operationKey = `transfer:booking:${bookingId}:provider:${booking.provider_id}`;
  const operation = await claimMoneyOperation(admin, {
    operationKey,
    operationType: "transfer",
    bookingId,
    amount: amountPence / 100,
    requestedBy,
  });
  if (operation.status === "succeeded") {
    if (!operation.stripe_object_id) {
      throw new Error("Completed transfer is missing its Stripe reference.");
    }
    const { error } = await admin.from("payouts")
      .update({ stripe_transfer_ref: operation.stripe_object_id })
      .eq("id", payout.id);
    if (error) throw new Error(error.message);
    if (payout.status !== "processing") await systemTransitionPayout(admin, payout.id, "processing");
    await systemTransitionPayout(admin, payout.id, "paid");
    return { earned: amountPence / 100, payoutSettled: true };
  }
  if (!operation.should_run) {
    return { earned: amountPence / 100, payoutSettled: false };
  }

  const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_ref);
  if (intent.status !== "succeeded" || intent.metadata.kind !== "booking" ||
      (booking.regular_series_id ? intent.metadata.upfront_regular !== "1" : intent.metadata.upfront_regular !== "0") ||
      !intent.latest_charge || intent.transfer_data) {
    const reason = intent.transfer_data
      ? "Legacy destination charge needs admin reconciliation; do not transfer again."
      : "Stripe charge is not settled for this visit.";
    await systemFinaliseMoneyOperation(admin, operation.id, "failed", { error: reason });
    if (payout.status === "failed") await systemTransitionPayout(admin, payout.id, "processing");
    await systemTransitionPayout(admin, payout.id, "held", { reason });
    await admin.rpc("open_review_case", {
      p_booking_id: bookingId, p_category: "payment_failure", p_priority: "high",
      p_blocks_payment: true, p_blocks_payout: true,
      p_notes: reason, p_created_by: null,
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }
  const { data: provider } = await admin.from("providers")
    .select("stripe_account_id").eq("id", booking.provider_id).maybeSingle();
  const destination = payoutDestination(provider?.stripe_account_id, {
    livemode: intent.livemode, testAccount: process.env.PROVIDER_TEST_ACCOUNT,
  });
  if (!destination) {
    await systemFinaliseMoneyOperation(admin, operation.id, "failed", { error: "Provider Stripe account is missing." });
    if (payout.status === "failed") await systemTransitionPayout(admin, payout.id, "processing");
    await systemTransitionPayout(admin, payout.id, "held", { reason: "Provider payout account is not configured" });
    await admin.rpc("open_review_case", {
      p_booking_id: bookingId, p_category: "payment_failure", p_priority: "high",
      p_blocks_payment: false, p_blocks_payout: true,
      p_notes: "Provider payout account is not configured for this visit.", p_created_by: null,
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }

  if (payout.status !== "processing") await systemTransitionPayout(admin, payout.id, "processing");
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create({
      amount: amountPence,
      currency: "gbp",
      destination,
      source_transaction: typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge.id,
      transfer_group: intent.transfer_group ?? undefined,
      metadata: { booking_id: bookingId, kind: booking.regular_series_id ? "regular_visit" : "one_off_visit", operation_key: operationKey },
    }, { idempotencyKey: operationKey });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Visit transfer failed";
    const definite = cause instanceof Stripe.errors.StripeInvalidRequestError;
    await systemFinaliseMoneyOperation(admin, operation.id, definite ? "failed" : "ambiguous", { error: reason }).catch(() => undefined);
    if (definite) await systemTransitionPayout(admin, payout.id, "failed", { reason });
    await admin.rpc("open_review_case", {
      p_booking_id: bookingId,
      p_category: "payout_failure",
      p_priority: "high",
      p_blocks_payment: false,
      p_blocks_payout: true,
      p_notes: `Visit transfer needs review: ${reason}`,
      p_created_by: null,
    });
    return { earned: amountPence / 100, payoutSettled: false };
  }
  // Stripe has committed the transfer. Record that fact before local payout
  // updates, so a retry can reconcile without ever creating a second transfer.
  await systemFinaliseMoneyOperation(admin, operation.id, "succeeded", { stripeObjectId: transfer.id });
  const { error } = await admin.from("payouts").update({ stripe_transfer_ref: transfer.id }).eq("id", payout.id);
  if (error) throw new Error(error.message);
  await systemTransitionPayout(admin, payout.id, "paid");
  return { earned: amountPence / 100, payoutSettled: true };
}
