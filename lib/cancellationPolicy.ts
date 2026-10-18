import {
  DEFAULT_CLEANING_BILLING_TERMS,
  type CleaningBillingTerms,
} from "./cleaningBillingTerms";

export type CancellationPolicyTier = "full" | "three_quarter" | "half" | "none";

export type CancellationPolicy = {
  tier: CancellationPolicyTier;
  hoursUntilBooking: number;
  refundPercent: number;
  refundAmount: number;
  refundPence: number;
  cancellationCharge: number;
  cancellationChargePence: number;
  title: string;
  explanation: string;
};

export type CancellationPaymentAction =
  | "release"
  | "capture"
  | "refund"
  | "none";

const HOUR_MS = 60 * 60 * 1000;

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

function londonDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/**
 * Customer cancellation terms. We apply the maximum charge allowed by the
 * published policy; administrators can still approve an exception or a larger
 * refund through the resolution desk.
 */
export function calculateCancellationPolicy(
  scheduledAt: string | Date,
  grossAmount: number,
  now: string | Date = new Date(),
  refunds: CleaningBillingTerms["cancellationRefundPercent"] = DEFAULT_CLEANING_BILLING_TERMS.cancellationRefundPercent,
): CancellationPolicy {
  const scheduledMs = new Date(scheduledAt).getTime();
  const nowMs = new Date(now).getTime();
  const hoursUntilBooking = (scheduledMs - nowMs) / HOUR_MS;
  const grossPence = Math.max(0, Math.round(Number(grossAmount || 0) * 100));

  const sameDay = londonDateKey(scheduledAt) === londonDateKey(now);
  const tier: CancellationPolicyTier =
    hoursUntilBooking <= 0 || sameDay
      ? "none"
      : hoursUntilBooking >= 48
        ? "full"
        : hoursUntilBooking >= 24
          ? "three_quarter"
          : "half";
  const refundPercent = refunds[tier];
  const refundPence = Math.round((grossPence * refundPercent) / 100);
  const cancellationChargePence = grossPence - refundPence;

  const title =
    refundPercent === 100
      ? "Full refund"
      : refundPercent === 0
        ? "No refund"
        : `${refundPercent}% refund`;
  const explanation =
    tier === "full"
      ? `This visit is at least 48 hours away. ${pounds(refundPence)} will be refunded or released, and the cancellation charge is ${pounds(cancellationChargePence)}.`
      : tier === "three_quarter"
        ? `This visit is between 24 and 48 hours away. ${pounds(refundPence)} will be refunded or released, and the cancellation charge is ${pounds(cancellationChargePence)}.`
        : tier === "half"
          ? `This visit is less than 24 hours away but is not today. ${pounds(refundPence)} will be refunded or released, and the cancellation charge is ${pounds(cancellationChargePence)}.`
          : `This is a same-day or missed booking. The cancellation charge is ${pounds(cancellationChargePence)}.`;

  return {
    tier,
    hoursUntilBooking,
    refundPercent,
    refundAmount: refundPence / 100,
    refundPence,
    cancellationCharge: cancellationChargePence / 100,
    cancellationChargePence,
    title,
    explanation,
  };
}

export function cancellationConfirmation(policy: CancellationPolicy) {
  return `Cancel this booking? ${policy.explanation}`;
}

export function cancellationPaymentAction(
  paymentStatus: string | null | undefined,
  policy: CancellationPolicy,
): CancellationPaymentAction {
  if (["succeeded", "partially_refunded"].includes(paymentStatus ?? "")) {
    return policy.refundPence > 0 ? "refund" : "none";
  }
  if (["authorised", "capture_failed"].includes(paymentStatus ?? "")) {
    return policy.cancellationChargePence > 0 ? "capture" : "release";
  }
  return "none";
}
