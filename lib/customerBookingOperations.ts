import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createAdmin } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { captureBookingPayment, LegacyDestinationCaptureError } from "@/lib/legacyDestinationCapture";
import {
  claimMoneyOperation,
  modifyCustomerBookingState,
  systemFinaliseMoneyOperation,
  systemTransitionPayment,
  transitionBooking,
} from "@/lib/bookingState";
import {
  APPOINTMENT_WINDOW_MESSAGE,
  appointmentFitsWindow,
  appointmentWithinBookingHorizon,
  BOOKING_HORIZON_MESSAGE,
} from "@/lib/appointmentWindow";
import {
  calculateCancellationPolicy,
  cancellationPaymentAction,
  type CancellationPolicyTier,
} from "@/lib/cancellationPolicy";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const admin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function notifyBookingProvider(
  bookingId: string,
  title: string,
  body: string,
) {
  const { data: booking } = await admin
    .from("bookings")
    .select("provider_id")
    .eq("id", bookingId)
    .maybeSingle();

  let providerId = booking?.provider_id ?? null;
  if (!providerId) {
    const { data: offer } = await admin
      .from("booking_offers")
      .select("provider_id")
      .eq("booking_id", bookingId)
      .in("status", ["accepted", "open"])
      .limit(1)
      .maybeSingle();
    providerId = offer?.provider_id ?? null;
  }
  if (!providerId) return;

  const { data: provider } = await admin
    .from("providers")
    .select("profile_id")
    .eq("id", providerId)
    .maybeSingle();
  if (!provider?.profile_id) return;

  await admin.from("notifications").insert({
    user_id: provider.profile_id,
    title,
    body,
    href: "/worker",
  });
}

async function notifyBookingChangeAudience(
  bookingId: string,
  title: string,
  body: string,
) {
  const { data: booking } = await admin
    .from("bookings")
    .select("customer_id, provider_id")
    .eq("id", bookingId)
    .maybeSingle();

  const recipients = new Map<string, string>();
  if (booking?.customer_id) {
    recipients.set(booking.customer_id, `/account/visit/${bookingId}`);
  }

  if (booking?.provider_id) {
    const { data: provider } = await admin
      .from("providers")
      .select("profile_id")
      .eq("id", booking.provider_id)
      .maybeSingle();
    if (provider?.profile_id) {
      recipients.set(provider.profile_id, `/worker/job/${bookingId}`);
    }
  }

  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin");
  for (const profile of admins ?? []) {
    recipients.set(profile.id, "/admin/bookings");
  }

  if (!recipients.size) return;
  await admin.from("notifications").insert(
    [...recipients].map(([userId, href]) => ({
      user_id: userId,
      title,
      body,
      href,
    })),
  );
}

/**
 * Cancel through the same booking/payment state machines regardless of which
 * interface initiated it. The supplied client must carry the customer's JWT;
 * transition_booking derives the actor and enforces ownership in PostgreSQL.
 */
export async function cancelCustomerBooking(
  supabase: SupabaseClient,
  id: string,
  reason?: string,
  source: "account" | "assistant" = "account",
  expectedPolicyTier?: CancellationPolicyTier,
) {
  const cleanReason = reason?.trim().slice(0, 240) || null;

  const { data: ownedBooking, error: bookingError } = await supabase
    .from("bookings")
    .select("scheduled_at")
    .eq("id", id)
    .maybeSingle();
  if (bookingError || !ownedBooking) {
    return {
      ok: false as const,
      message: "This booking could not be found or cancelled.",
    };
  }

  const { data: payments } = await admin
    .from("payments")
    .select("id, stripe_payment_ref, status, gross_amount, split_breakdown")
    .eq("booking_id", id)
    .or("kind.is.null,kind.neq.tip")
    .limit(1);

  const payment = payments?.[0];
  const originalGross = Number(payment?.gross_amount ?? 0);
  const policy = calculateCancellationPolicy(
    ownedBooking.scheduled_at,
    originalGross,
  );
  if (expectedPolicyTier && expectedPolicyTier !== policy.tier) {
    return {
      ok: false as const,
      message: `The cancellation window changed before confirmation. Please review the updated policy: ${policy.explanation}`,
      policy,
    };
  }

  const cancellation = await transitionBooking(supabase, id, "cancelled", {
    reason: cleanReason
      ? `Customer cancelled: ${cleanReason}`
      : "Customer cancelled the booking",
    meta: {
      source,
      cancellation_policy: policy.tier,
      refund_percent: policy.refundPercent,
      refund_amount: policy.refundAmount,
      cancellation_charge: policy.cancellationCharge,
      ...(cleanReason ? { cancellation_reason: cleanReason } : {}),
    },
  });
  if (!cancellation.changed) {
    return {
      ok: true as const,
      message: "This booking was already cancelled.",
      policy,
    };
  }

  let paymentMessage = "Booking cancelled. No payment adjustment was needed.";
  if (payment?.stripe_payment_ref && originalGross > 0) {
    const isCaptured = ["succeeded", "partially_refunded"].includes(payment.status);
    const paymentAction = cancellationPaymentAction(payment.status, policy);
    const shouldRefundCaptured = paymentAction === "refund";
    const shouldReleaseHold = paymentAction === "release";
    const shouldCaptureCharge = paymentAction === "capture";
    const operationType = shouldRefundCaptured
      ? "refund"
      : shouldReleaseHold
        ? "release"
        : "capture";
    const operationAmount = shouldRefundCaptured
      ? policy.refundAmount
      : shouldReleaseHold
        ? originalGross
        : policy.cancellationCharge;
    const operationKey = shouldRefundCaptured
      ? policy.tier === "full"
        ? `refund:booking:${id}:full`
        : `refund:booking:${id}:${policy.refundPercent}`
      : shouldReleaseHold
        ? `release:booking:${id}`
        : `capture:cancellation:${id}:${policy.cancellationChargePence}`;

    let moneyOperationSucceeded = false;
    try {
      if (shouldRefundCaptured) {
        await systemTransitionPayment(admin, payment.id, "refund_pending", {
          reason: `Customer cancellation policy: ${policy.title}`,
        });
      } else if (shouldReleaseHold) {
        await systemTransitionPayment(admin, payment.id, "cancelling");
      } else if (shouldCaptureCharge) {
        await systemTransitionPayment(admin, payment.id, "capturing");
      } else {
        paymentMessage =
          "Booking cancelled. The booking amount is non-refundable.";
      }

      if (shouldRefundCaptured || shouldReleaseHold || shouldCaptureCharge) {
        const operation = await claimMoneyOperation(admin, {
          operationKey,
          operationType,
          bookingId: id,
          amount: operationAmount,
        });
        moneyOperationSucceeded = operation.status === "succeeded";

        if (operation.should_run) {
          try {
            let stripeObject: Stripe.Refund | Stripe.PaymentIntent;
            if (shouldRefundCaptured) {
              stripeObject = await stripe.refunds.create(
                {
                  payment_intent: payment.stripe_payment_ref,
                  amount: policy.refundPence,
                  metadata: {
                    operation_key: operationKey,
                    booking_id: id,
                    policy_tier: policy.tier,
                  },
                },
                { idempotencyKey: operationKey },
              );
            } else if (shouldReleaseHold) {
              stripeObject = await stripe.paymentIntents.cancel(
                payment.stripe_payment_ref,
                {},
                { idempotencyKey: operationKey },
              );
            } else {
              const split = (payment.split_breakdown ?? {}) as Record<
                string,
                unknown
              >;
              const originalPlatformFee = Number(
                split.platform_margin ?? originalGross,
              );
              const retainedRatio = policy.cancellationCharge / originalGross;
              const platformFeePence = Math.min(
                policy.cancellationChargePence,
                Math.max(
                  0,
                  Math.round(originalPlatformFee * retainedRatio * 100),
                ),
              );
              stripeObject = await captureBookingPayment(
                stripe,
                payment.stripe_payment_ref,
                {
                  amount_to_capture: policy.cancellationChargePence,
                  metadata: {
                    operation_key: operationKey,
                    booking_id: id,
                    policy_tier: policy.tier,
                  },
                },
                { idempotencyKey: operationKey },
              );

              if (policy.refundPercent > 0 && policy.refundPercent < 100) {
                const platformFee = platformFeePence / 100;
                const update = await admin
                  .from("payments")
                  .update({
                    gross_amount: policy.cancellationCharge,
                    split_breakdown: {
                      ...split,
                      provider: Number(
                        (policy.cancellationCharge - platformFee).toFixed(2),
                      ),
                      platform_margin: platformFee,
                      original_gross_amount: originalGross,
                      cancellation_refund: policy.refundAmount,
                      cancellation_policy: policy.tier,
                    },
                  })
                  .eq("id", payment.id);
                if (update.error) {
                  await admin.rpc("open_review_case", {
                    p_booking_id: id,
                    p_category: "payment_failure",
                    p_priority: "high",
                    p_blocks_payment: false,
                    p_blocks_payout: true,
                    p_notes: `Cancellation charge captured, but payment totals need reconciliation: ${update.error.message}`,
                    p_created_by: null,
                  });
                }
              }
            }

            moneyOperationSucceeded = true;
            await systemFinaliseMoneyOperation(admin, operation.id, "succeeded", {
              stripeObjectId: stripeObject.id,
            });
          } catch (error) {
            const failure =
              error instanceof Error
                ? error.message
                : "Stripe cancellation adjustment failed";
            const definite =
              error instanceof LegacyDestinationCaptureError ||
              error instanceof Stripe.errors.StripeCardError ||
              error instanceof Stripe.errors.StripeInvalidRequestError;
            await systemFinaliseMoneyOperation(
              admin,
              operation.id,
              definite ? "failed" : "ambiguous",
              { error: failure },
            ).catch(() => undefined);
            throw error;
          }
        } else if (operation.status === "ambiguous") {
          throw new Error(
            "Stripe outcome is ambiguous; reconciliation required",
          );
        }

        if (operation.status === "succeeded" || operation.should_run) {
          await systemTransitionPayment(
            admin,
            payment.id,
            shouldRefundCaptured
              ? policy.tier === "full"
                ? "refunded"
                : "partially_refunded"
              : shouldReleaseHold
                ? "cancelled"
                : "succeeded",
          );
        }
      }

      paymentMessage =
        paymentAction === "none" && !isCaptured
          ? "Booking cancelled. No completed card payment needed adjustment."
          : policy.tier === "full"
          ? isCaptured
            ? `Booking cancelled. Your full £${policy.refundAmount.toFixed(2)} refund has been started.`
            : "Booking cancelled. Your full card hold is being released."
          : policy.refundPercent > 0
            ? isCaptured
              ? `Booking cancelled. Your ${policy.refundPercent}% refund of £${policy.refundAmount.toFixed(2)} has been started.`
              : `Booking cancelled. £${policy.cancellationCharge.toFixed(2)} has been charged and the remaining ${policy.refundPercent}% of the hold is being released.`
            : `Booking cancelled. The £${policy.cancellationCharge.toFixed(2)} booking amount is non-refundable.`;
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : "Stripe cancellation failed";
      const fallback = shouldRefundCaptured
        ? payment.status === "partially_refunded"
          ? "partially_refunded"
          : "succeeded"
        : shouldReleaseHold
          ? "authorised"
          : "capture_failed";
      if (!moneyOperationSucceeded) {
        await systemTransitionPayment(admin, payment.id, fallback, {
          reason: failure,
        }).catch(() => undefined);
      }
      await admin.rpc("open_review_case", {
        p_booking_id: id,
        p_category: "payment_failure",
        p_priority: "high",
        p_blocks_payment: true,
        p_blocks_payout: true,
        p_notes: failure,
        p_created_by: null,
      });
      paymentMessage =
        "Booking cancelled. The payment adjustment needs attention; support has been notified and you should not pay again.";
    }
  }

  await notifyBookingProvider(
    id,
    "Booking cancelled",
    `The customer cancelled this visit. It's been removed from your schedule. ${policy.title} applies.`,
  );

  revalidatePath("/account");
  revalidatePath(`/account/visit/${id}`);
  revalidatePath("/worker");

  return {
    ok: true as const,
    message: paymentMessage,
    policy,
  };
}

export async function rescheduleCustomerBooking(
  supabase: SupabaseClient,
  id: string,
  newSlot: string,
  reason?: string,
  note?: string,
  source: "account" | "assistant" = "account",
) {
  if (!newSlot) return { ok: false as const, message: "Choose a new time." };

  const { data: bookingForDuration } = await admin
    .from("bookings")
    .select("duration_minutes, packages(duration_minutes)")
    .eq("id", id)
    .maybeSingle();
  const packageRow = Array.isArray(bookingForDuration?.packages)
    ? bookingForDuration.packages[0]
    : bookingForDuration?.packages;
  if (!appointmentFitsWindow(newSlot, bookingForDuration?.duration_minutes ?? packageRow?.duration_minutes ?? 120)) {
    return { ok: false as const, message: APPOINTMENT_WINDOW_MESSAGE };
  }
  if (!appointmentWithinBookingHorizon(newSlot)) {
    return { ok: false as const, message: BOOKING_HORIZON_MESSAGE };
  }

  const cleanReason = reason?.trim().slice(0, 120) || "Schedule changed";
  const cleanNote = note?.trim().slice(0, 250) || null;

  let result;
  try {
    result = await modifyCustomerBookingState(supabase, {
      bookingId: id,
      newSlot,
      reason: `Customer rescheduled: ${cleanReason}`,
      meta: {
        source,
        reschedule_reason: cleanReason,
        ...(cleanNote ? { customer_message: cleanNote } : {}),
      },
    });
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "This visit could not be moved.",
    };
  }

  const when = new Date(newSlot).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  await notifyBookingChangeAudience(
    id,
    "Booking time changed",
    `The customer moved this visit to ${when}.${
      cleanNote ? ` Their message: ${cleanNote}` : ""
    }`,
  );

  revalidatePath("/account");
  revalidatePath(`/account/visit/${id}`);
  revalidatePath("/worker");

  return {
    ok: true as const,
    message: result.changed ? `Visit moved to ${when}.` : "No changes were needed.",
  };
}

export async function modifyCustomerBooking(
  supabase: SupabaseClient,
  input: {
    id: string;
    newSlot: string;
    packageId: string;
    householdNotes: string;
    reason?: string;
    message?: string;
  },
) {
  const cleanReason = input.reason?.trim().slice(0, 120) || "Booking updated";
  const cleanMessage = input.message?.trim().slice(0, 250) || null;
  const cleanNotes = input.householdNotes.trim().slice(0, 1000);

  const { data: selectedPackage } = await admin
    .from("packages")
    .select("name, duration_minutes")
    .eq("id", input.packageId)
    .maybeSingle();
  if (!selectedPackage) {
    return { ok: false as const, message: "Choose an available service." };
  }
  if (
    !appointmentFitsWindow(
      input.newSlot,
      selectedPackage.duration_minutes ?? 120,
    )
  ) {
    return { ok: false as const, message: APPOINTMENT_WINDOW_MESSAGE };
  }
  if (!appointmentWithinBookingHorizon(input.newSlot)) {
    return { ok: false as const, message: BOOKING_HORIZON_MESSAGE };
  }

  let result;
  try {
    result = await modifyCustomerBookingState(supabase, {
      bookingId: input.id,
      newSlot: input.newSlot,
      packageId: input.packageId,
      householdNotes: cleanNotes,
      updateNotes: true,
      reason: `Customer modified booking: ${cleanReason}`,
      meta: {
        source: "account",
        modification_reason: cleanReason,
        ...(cleanMessage ? { customer_message: cleanMessage } : {}),
      },
    });
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "This booking could not be updated.",
    };
  }

  if (!result.changed) {
    return { ok: true as const, message: "No changes were needed." };
  }

  const when = new Date(result.scheduled_at).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const changes = [
    result.time_changed ? `new time: ${when}` : null,
    result.service_changed ? `service: ${selectedPackage.name}` : null,
    result.visit_notes_changed ? "visit instructions updated" : null,
  ].filter(Boolean);

  await notifyBookingChangeAudience(
    input.id,
    "Booking updated",
    `The customer changed this booking (${changes.join(", ")}).${
      cleanMessage ? ` Message: ${cleanMessage}` : ""
    }`,
  );

  revalidatePath("/account");
  revalidatePath(`/account/visit/${input.id}`);
  revalidatePath("/worker");
  revalidatePath(`/worker/job/${input.id}`);
  revalidatePath("/admin");
  revalidatePath("/admin/bookings");

  return { ok: true as const, message: "Booking updated successfully." };
}
