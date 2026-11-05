import { MINIMUM_TIP_PENCE, type VisitLine } from "./visitBillingPolicy";

/** Booking tips are optional, integer GBP pence, and never a platform fee.
 * Do not coerce strings/booleans from checkout requests into money. */
export function optionalBookingTipPence(value: unknown = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (value > 0 && value < MINIMUM_TIP_PENCE)
  )
    throw new Error("Choose no tip or a tip of at least £3.");
  return value;
}

export function bookingTipLine(value: unknown = 0): VisitLine | null {
  const pence = optionalBookingTipPence(value);
  return pence
    ? {
        id: "tip",
        label: "Tip for your cleaner",
        amountPence: pence,
        reservedMinutes: 0,
      }
    : null;
}

/** Only the funded, unrefunded tip belongs in the cleaner's completed-visit
 * payout. Cancellation returns this amount in full instead of paying it out. */
export function retainedBookingTipPence(
  lines: VisitLine[],
  refundedLines: Record<string, number>,
): number {
  const tips = lines.filter((line) => line.id === "tip");
  if (tips.length > 1) throw new Error("Duplicate booking tip line.");
  const amount = tips.length ? optionalBookingTipPence(tips[0].amountPence) : 0;
  const refunded = refundedLines.tip ?? 0;
  if (!Number.isSafeInteger(refunded) || refunded < 0 || refunded > amount)
    throw new Error("The booking tip refund needs reconciliation.");
  if (tips.some((tip) => tip.reservedMinutes !== 0))
    throw new Error("A booking tip cannot reserve cleaning time.");
  return amount - refunded;
}
