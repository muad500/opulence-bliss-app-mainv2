import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { settleCompletedVisitPayout } from "@/lib/prepaidVisitPayout";
import { captureBookingPayment, LegacyDestinationCaptureError } from "@/lib/legacyDestinationCapture";
import { isTestStripeKey, payoutDestination } from "@/lib/payoutDestination";
import {
  claimMoneyOperation,
  maybeReleasePayout,
  systemFinaliseMoneyOperation,
  systemTransitionBooking,
  systemTransitionPayment,
  systemTransitionPayout,
} from "@/lib/bookingState";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function automaticallyCompleteBooking(bookingId: string) {
  const transition = await systemTransitionBooking(
    admin,
    bookingId,
    "completed",
    "Automatically checked out 10 minutes after the selected cleaning duration ended",
    { source: "provider_auto_checkout" },
  );
  if (!transition.changed) return { changed: false, paymentSettled: false };

  const checkedOutAt = new Date().toISOString();
  await admin
    .from("check_ins")
    .update({ left_at: checkedOutAt })
    .eq("booking_id", bookingId)
    .is("left_at", null);

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("subscription_id, regular_series_id, provider_id, provider_payout, membership_fee_deducted, customer_id, customer_email, packages(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError || !booking) throw new Error(bookingError?.message ?? "Booking not found after automatic checkout.");

  let paymentSettled = Boolean(booking.subscription_id || booking.regular_series_id);
  let earned = Number(booking.provider_payout ?? 0);

  if (booking.regular_series_id) {
    try {
      const result = await settleCompletedVisitPayout(bookingId);
      earned = result.earned;
      paymentSettled = true;
    } catch (cause) {
      console.error(`Prepaid visit ${bookingId} payout needs review:`, cause);
      await admin.rpc("open_review_case", {
        p_booking_id: bookingId,
        p_category: "payment_failure",
        p_priority: "high",
        p_blocks_payment: false,
        p_blocks_payout: true,
        p_notes: cause instanceof Error ? cause.message : "Prepaid transfer failed",
        p_created_by: null,
      });
    }
  } else if (booking.subscription_id) {
    const { data: existing } = await admin
      .from("payouts")
      .select("id, status")
      .eq("booking_id", bookingId)
      .maybeSingle();
    let payoutId = existing?.id ?? null;
    if (!payoutId && earned > 0 && booking.provider_id) {
      const { data: created, error } = await admin
        .from("payouts")
        .insert({
          provider_id: booking.provider_id,
          booking_id: bookingId,
          amount: earned,
          status: "not_ready",
          note: Number(booking.membership_fee_deducted ?? 0) > 0
            ? `Membership fee of £${Number(booking.membership_fee_deducted).toFixed(2)} deducted`
            : null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      payoutId = created.id;
    }

    if (payoutId && earned > 0 && booking.provider_id) {
      await maybeReleasePayout(admin, bookingId);
      const { data: ready } = await admin.from("payouts").select("status").eq("id", payoutId).maybeSingle();
      if (ready?.status === "pending") {
        const operationKey = `transfer:booking:${bookingId}:provider:${booking.provider_id}`;
        const operation = await claimMoneyOperation(admin, {
          operationKey,
          operationType: "transfer",
          bookingId,
          amount: earned,
        });
        if (operation.should_run) {
          const { data: provider } = await admin
            .from("providers")
            .select("stripe_account_id")
            .eq("id", booking.provider_id)
            .maybeSingle();
          const destination = payoutDestination(provider?.stripe_account_id, {
            livemode: !isTestStripeKey(process.env.STRIPE_SECRET_KEY),
            testAccount: process.env.PROVIDER_TEST_ACCOUNT,
          });
          if (!destination) {
            await systemFinaliseMoneyOperation(admin, operation.id, "failed", {
              error: "Provider payout account is not configured",
            });
            await systemTransitionPayout(admin, payoutId, "held", { reason: "Provider payout account is not configured" });
            await admin.rpc("open_review_case", {
              p_booking_id: bookingId, p_category: "payout_failure", p_priority: "high",
              p_blocks_payment: false, p_blocks_payout: true,
              p_notes: "Provider payout account is not configured", p_created_by: null,
            });
          } else {
            await systemTransitionPayout(admin, payoutId, "processing");
            try {
              const transfer = await stripe.transfers.create(
                { amount: Math.round(earned * 100), currency: "gbp", destination,
                  metadata: { booking_id: bookingId, kind: "membership_visit", operation_key: operationKey } },
                { idempotencyKey: operationKey },
              );
              await systemFinaliseMoneyOperation(admin, operation.id, "succeeded", { stripeObjectId: transfer.id });
              await admin.from("payouts").update({ stripe_transfer_ref: transfer.id }).eq("id", payoutId);
              await systemTransitionPayout(admin, payoutId, "paid");
            } catch (error) {
              const reason = error instanceof Error ? error.message : "Stripe transfer failed";
              const definite = error instanceof Stripe.errors.StripeInvalidRequestError;
              await systemFinaliseMoneyOperation(admin, operation.id, definite ? "failed" : "ambiguous", { error: reason });
              if (definite) await systemTransitionPayout(admin, payoutId, "failed", { reason });
            }
          }
        } else if (operation.status === "succeeded") {
          await systemTransitionPayout(admin, payoutId, "processing");
          await systemTransitionPayout(admin, payoutId, "paid");
        }
      }
    }
  } else {
    const { data: payments } = await admin
      .from("payments")
      .select("id, stripe_payment_ref, status, split_breakdown, gross_amount")
      .eq("booking_id", bookingId)
      .limit(1);
    const payment = payments?.[0];
    earned = Number((payment?.split_breakdown as { provider?: number } | null)?.provider ?? 0);
    if (payment?.status === "succeeded") {
      paymentSettled = true;
    } else if (payment?.stripe_payment_ref && ["authorised", "capture_failed"].includes(payment.status)) {
      const operationKey = `capture:booking:${bookingId}`;
      await systemTransitionPayment(admin, payment.id, "capturing");
      const operation = await claimMoneyOperation(admin, {
        operationKey,
        operationType: "capture",
        bookingId,
        amount: Number(payment.gross_amount ?? 0),
      });
      if (operation.should_run) {
        try {
          const intent = await captureBookingPayment(stripe, payment.stripe_payment_ref, {}, { idempotencyKey: operationKey });
          await systemFinaliseMoneyOperation(admin, operation.id, "succeeded", { stripeObjectId: intent.id });
          await systemTransitionPayment(admin, payment.id, "succeeded");
          paymentSettled = true;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Capture failed";
          const definite = error instanceof LegacyDestinationCaptureError || error instanceof Stripe.errors.StripeCardError || error instanceof Stripe.errors.StripeInvalidRequestError;
          await systemFinaliseMoneyOperation(admin, operation.id, definite ? "failed" : "ambiguous", { error: reason });
          if (definite) await systemTransitionPayment(admin, payment.id, "capture_failed", { reason });
          await systemTransitionBooking(admin, bookingId, "needs_review", "Payment capture failed after automatic checkout", {
            payment_id: payment.id,
            operation_id: operation.id,
          });
          await admin.rpc("open_review_case", {
            p_booking_id: bookingId,
            p_category: "payment_failure",
            p_priority: "urgent",
            p_blocks_payment: true,
            p_blocks_payout: true,
            p_notes: reason,
            p_created_by: null,
          });
        }
      } else if (operation.status === "succeeded") {
        await systemTransitionPayment(admin, payment.id, "succeeded");
        paymentSettled = true;
      } else if (operation.status === "ambiguous") {
        await systemTransitionBooking(admin, bookingId, "needs_review", "Payment capture outcome is ambiguous", {
          payment_id: payment.id,
          operation_id: operation.id,
        });
      }
    }
    if (paymentSettled && payment) {
      try {
        const result = await settleCompletedVisitPayout(bookingId);
        earned = result.earned;
      } catch (cause) {
        console.error(`One-off visit ${bookingId} payout needs review:`, cause);
        await admin.rpc("open_review_case", {
          p_booking_id: bookingId, p_category: "payout_failure", p_priority: "high",
          p_blocks_payment: false, p_blocks_payout: true,
          p_notes: cause instanceof Error ? cause.message : "One-off transfer failed",
          p_created_by: null,
        });
      }
    }
  }

  const packageValue = booking.packages as { name?: string } | { name?: string }[] | null;
  const service = (Array.isArray(packageValue) ? packageValue[0]?.name : packageValue?.name) ?? "Your visit";
  const title = paymentSettled ? "Visit automatically completed" : "Visit completed — payment under review";
  const body = paymentSettled
    ? `${service} was checked out automatically after the selected cleaning duration ended.`
    : `${service} was checked out automatically. We are checking the payment; do not retry it.`;
  if (booking.customer_id) {
    await admin.from("notifications").insert({ user_id: booking.customer_id, title, body, href: `/account/visit/${bookingId}` });
  }
  const { data: provider } = booking.provider_id
    ? await admin
        .from("providers")
        .select("profile_id, profiles(email)")
        .eq("id", booking.provider_id)
        .maybeSingle()
    : { data: null };
  if (provider?.profile_id) {
    await admin.from("notifications").insert({
      user_id: provider.profile_id,
      title: "Job automatically checked out",
      body: `${service} was checked out 10 minutes after the selected cleaning duration ended. Your invoice is ready in Earnings.`,
      href: "/worker/earnings",
    });
  }
  const profileValue = provider?.profiles as { email?: string | null } | { email?: string | null }[] | null | undefined;
  const providerEmail = Array.isArray(profileValue) ? profileValue[0]?.email : profileValue?.email;
  await sendEmail({
    to: providerEmail,
    subject: "Your job was automatically checked out",
    title: "Job checked out",
    body: `<p><strong>${service}</strong> was checked out automatically 10 minutes after the selected cleaning duration ended. Your invoice is ready in Earnings.</p>`,
    cta: { text: "View earnings", url: "/worker/earnings" },
  });
  await sendEmail({
    to: booking.customer_email,
    subject: title,
    title,
    body: `<p>${body}</p>`,
    cta: { text: "View your visit", url: `/account/visit/${bookingId}` },
  });

  return { changed: true, paymentSettled, earned, checkedOutAt };
}
