import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  claimMoneyOperation,
  systemFinaliseMoneyOperation,
  systemTransitionPayout,
} from "@/lib/bookingState";
import { payoutDestination } from "@/lib/payoutDestination";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** Settle a captured tip once, to the professional who completed the visit. */
export async function settleTipPayout(paymentId: string, requestedBy?: string) {
  const { data: payment, error: paymentError } = await admin.from("payments")
    .select("id, booking_id, kind, status, gross_amount, stripe_payment_ref")
    .eq("id", paymentId).single();
  if (paymentError || !payment || payment.kind !== "tip" || payment.status !== "succeeded" ||
      !payment.booking_id || !payment.stripe_payment_ref) {
    throw new Error("A captured tip payment is required.");
  }
  const { data: booking, error: bookingError } = await admin.from("bookings")
    .select("id, status, provider_id").eq("id", payment.booking_id).single();
  if (bookingError || !booking || booking.status !== "completed" || !booking.provider_id) {
    throw new Error("The tip must belong to a completed, assigned booking.");
  }
  const amountPence = Math.round(Number(payment.gross_amount) * 100);
  if (!Number.isSafeInteger(amountPence) || amountPence <= 0) throw new Error("Invalid tip amount.");

  const found = await admin.from("payouts")
    .select("id, status, amount, stripe_transfer_ref")
    .eq("payment_id", paymentId).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  let payout = found.data;
  if (!payout) {
    const created = await admin.from("payouts").insert({
      payment_id: paymentId,
      booking_id: booking.id,
      provider_id: booking.provider_id,
      amount: amountPence / 100,
      status: "not_ready",
      note: "Customer tip",
    }).select("id, status, amount, stripe_transfer_ref").single();
    if (created.error) {
      // Another finaliser may have inserted the same payout concurrently.
      const retry = await admin.from("payouts").select("id, status, amount, stripe_transfer_ref")
        .eq("payment_id", paymentId).single();
      if (retry.error) throw new Error(created.error.message);
      payout = retry.data;
    } else payout = created.data;
  }
  if (payout.status === "paid" && payout.stripe_transfer_ref) return { payoutSettled: true };
  if (Math.round(Number(payout.amount) * 100) !== amountPence) {
    const reason = "Tip payout amount differs from the captured tip";
    if (["not_ready", "pending", "failed"].includes(payout.status)) {
      await systemTransitionPayout(admin, payout.id, "held", { reason });
    }
    await admin.rpc("open_review_case", {
      p_booking_id: booking.id, p_category: "payout_failure", p_priority: "high",
      p_blocks_payment: false, p_blocks_payout: true,
      p_notes: reason, p_created_by: requestedBy ?? null,
    });
    return { payoutSettled: false };
  }
  const { count: blockingCases, error: caseError } = await admin.from("review_cases")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id)
    .neq("status", "resolved")
    .or("blocks_payment.eq.true,blocks_payout.eq.true");
  if (caseError) throw new Error(caseError.message);
  if ((blockingCases ?? 0) > 0) {
    if (["not_ready", "pending", "failed"].includes(payout.status)) {
      await systemTransitionPayout(admin, payout.id, "held", {
        reason: "An open review case blocks the tip payout",
      });
    }
    return { payoutSettled: false };
  }
  if (payout.status === "not_ready") {
    await systemTransitionPayout(admin, payout.id, "pending", { reason: "Completed visit and captured tip" });
    payout = { ...payout, status: "pending" };
  }
  if (!["pending", "processing", "failed"].includes(payout.status)) return { payoutSettled: false };

  const operationKey = `transfer:tip:${payment.stripe_payment_ref}:provider:${booking.provider_id}`;
  const operation = await claimMoneyOperation(admin, {
    operationKey, operationType: "transfer", bookingId: booking.id,
    amount: amountPence / 100, requestedBy,
  });
  if (operation.status === "succeeded") {
    if (!operation.stripe_object_id) throw new Error("Completed tip transfer has no Stripe reference.");
    const { error } = await admin.from("payouts")
      .update({ stripe_transfer_ref: operation.stripe_object_id }).eq("id", payout.id);
    if (error) throw new Error(error.message);
    if (payout.status !== "processing") await systemTransitionPayout(admin, payout.id, "processing");
    await systemTransitionPayout(admin, payout.id, "paid");
    return { payoutSettled: true };
  }
  if (!operation.should_run) return { payoutSettled: false };

  const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_ref);
  const invalidCharge = intent.status !== "succeeded" || intent.metadata.kind !== "tip" ||
    intent.metadata.booking_id !== booking.id || !intent.latest_charge || Boolean(intent.transfer_data);
  const { data: provider } = await admin.from("providers")
    .select("stripe_account_id").eq("id", booking.provider_id).maybeSingle();
  const destination = payoutDestination(provider?.stripe_account_id, {
    livemode: intent.livemode, testAccount: process.env.PROVIDER_TEST_ACCOUNT,
  });
  if (invalidCharge || !destination) {
    const reason = intent.transfer_data
      ? "Legacy destination tip needs admin reconciliation; do not transfer again."
      : invalidCharge ? "Tip charge requires review" : "Provider payout account is not configured";
    await systemFinaliseMoneyOperation(admin, operation.id, "failed", { error: reason });
    await systemTransitionPayout(admin, payout.id, "held", { reason });
    await admin.rpc("open_review_case", {
      p_booking_id: booking.id, p_category: "payout_failure", p_priority: "high",
      p_blocks_payment: false, p_blocks_payout: true,
      p_notes: `Tip payout: ${reason}`, p_created_by: requestedBy ?? null,
    });
    return { payoutSettled: false };
  }

  if (payout.status !== "processing") await systemTransitionPayout(admin, payout.id, "processing");
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create({
      amount: amountPence, currency: "gbp", destination,
      source_transaction: typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge!.id,
      transfer_group: intent.transfer_group ?? undefined,
      metadata: { kind: "tip", booking_id: booking.id, payment_id: paymentId, operation_key: operationKey },
    }, { idempotencyKey: operationKey });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Tip transfer failed";
    const definite = cause instanceof Stripe.errors.StripeInvalidRequestError;
    await systemFinaliseMoneyOperation(admin, operation.id, definite ? "failed" : "ambiguous", { error: reason });
    if (definite) await systemTransitionPayout(admin, payout.id, "failed", { reason });
    await admin.rpc("open_review_case", {
      p_booking_id: booking.id, p_category: "payout_failure", p_priority: "high",
      p_blocks_payment: false, p_blocks_payout: true,
      p_notes: `Tip transfer needs review: ${reason}`, p_created_by: requestedBy ?? null,
    });
    return { payoutSettled: false };
  }
  await systemFinaliseMoneyOperation(admin, operation.id, "succeeded", { stripeObjectId: transfer.id });
  const { error } = await admin.from("payouts").update({ stripe_transfer_ref: transfer.id }).eq("id", payout.id);
  if (error) throw new Error(error.message);
  await systemTransitionPayout(admin, payout.id, "paid");
  return { payoutSettled: true };
}
