import type { VisitLine } from "./visitBillingPolicy";
import { calculateCancellationPolicy } from "./cancellationPolicy";
import type { CleaningBillingTerms } from "./cleaningBillingTerms";
import { cancellationPeriodEnd } from "./cancellationPeriod";

export type VisitCharge = {
  id: string;
  operation_id?: string | null;
  stripe_payment_intent: string;
  amount_pence: number;
  refunded_pence: number;
  line_items: VisitLine[];
  refunded_lines: Record<string, number>;
};
export type VisitRefundPlan = {
  chargeId: string;
  intentId: string;
  amountPence: number;
  refundedLines: Record<string, number>;
};

/** Refund removed lines from the intents that actually funded those lines. */
export function removedLineRefunds(
  charges: VisitCharge[],
  removed: VisitLine[],
) {
  const remaining = new Map(removed.map((line) => [line.id, line.amountPence]));
  const refunds: VisitRefundPlan[] = [];
  for (const charge of [...charges].reverse()) {
    const refundedLines = { ...charge.refunded_lines };
    let amountPence = 0;
    for (const line of charge.line_items) {
      const available = line.amountPence - (refundedLines[line.id] ?? 0);
      const amount = Math.min(available, remaining.get(line.id) ?? 0);
      if (amount <= 0) continue;
      remaining.set(line.id, (remaining.get(line.id) ?? 0) - amount);
      refundedLines[line.id] = (refundedLines[line.id] ?? 0) + amount;
      amountPence += amount;
    }
    if (amountPence > charge.amount_pence - charge.refunded_pence)
      throw new Error("The payment needs reconciliation.");
    if (amountPence)
      refunds.push({
        chargeId: charge.id,
        intentId: charge.stripe_payment_intent,
        amountPence,
        refundedLines,
      });
  }
  if ([...remaining.values()].some((amount) => amount !== 0))
    throw new Error("The removed add-on has no matching paid line item.");
  return refunds;
}

/** Cancellation applies to the remaining paid amount, never the planned price. */
export function cancellationRefunds(
  charges: VisitCharge[],
  refundPercent: number,
  cleaningHoursOnly = false,
  bookingTotal = false,
) {
  if (
    !Number.isInteger(refundPercent) ||
    refundPercent < 0 ||
    refundPercent > 100
  )
    throw new Error("Invalid refund percentage.");
  if (bookingTotal) {
    const paid = charges.reduce(
      (sum, charge) => sum + charge.amount_pence - charge.refunded_pence,
      0,
    );
    const target = paid - Math.round((paid * (100 - refundPercent)) / 100);
    let cumulative = 0,
      allocated = 0;
    return charges.flatMap((charge) => {
      const refundedLines = { ...charge.refunded_lines };
      let amountPence = 0,
        remainingLines = 0;
      for (const line of charge.line_items) {
        const available = line.amountPence - (refundedLines[line.id] ?? 0);
        if (available < 0 || line.id === "tip")
          throw new Error("The booking payment needs reconciliation.");
        remainingLines += available;
        cumulative += available;
        const next = paid
          ? target === 0
            ? 0
            : Math.round((cumulative * target) / paid)
          : 0;
        const amount = next - allocated;
        allocated = next;
        refundedLines[line.id] = (refundedLines[line.id] ?? 0) + amount;
        amountPence += amount;
      }
      if (remainingLines !== charge.amount_pence - charge.refunded_pence)
        throw new Error(
          "The payment needs line-item reconciliation before cancellation.",
        );
      return amountPence
        ? [
            {
              chargeId: charge.id,
              intentId: charge.stripe_payment_intent,
              amountPence,
              refundedLines,
            },
          ]
        : [];
    });
  }
  if (cleaningHoursOnly) {
    // Round the cleaning refund once across all funding intents, not once per
    // line/charge (which can drift by pennies after add-on changes).
    const cleaningPaid = charges.reduce(
      (sum, charge) =>
        sum +
        charge.line_items
          .filter((line) => line.id === "cleaning")
          .reduce(
            (total, line) =>
              total +
              Math.max(
                0,
                line.amountPence - (charge.refunded_lines[line.id] ?? 0),
              ),
            0,
          ),
      0,
    );
    let cleaningRefundRemaining =
      cleaningPaid - Math.round((cleaningPaid * (100 - refundPercent)) / 100);
    const refunds: VisitRefundPlan[] = [];
    for (const charge of charges) {
      const refundedLines = { ...charge.refunded_lines };
      let amountPence = 0;
      let unrefundedLines = 0;
      for (const line of charge.line_items) {
        const available = Math.max(
          0,
          line.amountPence - (refundedLines[line.id] ?? 0),
        );
        unrefundedLines += available;
        const amount =
          line.id === "cleaning"
            ? Math.min(available, cleaningRefundRemaining)
            : available;
        if (line.id === "cleaning") cleaningRefundRemaining -= amount;
        refundedLines[line.id] = (refundedLines[line.id] ?? 0) + amount;
        amountPence += amount;
      }
      // Never guess when an old/manual refund has not been allocated to lines.
      if (unrefundedLines !== charge.amount_pence - charge.refunded_pence)
        throw new Error(
          "The payment needs line-item reconciliation before cancellation.",
        );
      if (amountPence)
        refunds.push({
          chargeId: charge.id,
          intentId: charge.stripe_payment_intent,
          amountPence,
          refundedLines,
        });
    }
    return refunds;
  }
  const paid = charges.reduce(
    (sum, charge) => sum + charge.amount_pence - charge.refunded_pence,
    0,
  );
  let remaining = Math.round((paid * refundPercent) / 100);
  const refunds: VisitRefundPlan[] = [];
  for (const charge of charges) {
    const amountPence = Math.min(
      remaining,
      charge.amount_pence - charge.refunded_pence,
    );
    if (amountPence > 0)
      refunds.push({
        chargeId: charge.id,
        intentId: charge.stripe_payment_intent,
        amountPence,
        refundedLines: charge.refunded_lines,
      });
    remaining -= amountPence;
  }
  return refunds;
}

export function changedVisitLines(before: VisitLine[], after: VisitLine[]) {
  const same = (a: VisitLine, b: VisitLine) =>
    a.id === b.id && a.amountPence === b.amountPence;
  return {
    added: after.filter((line) => !before.some((old) => same(line, old))),
    removed: before.filter((line) => !after.some((next) => same(line, next))),
  };
}

/** One source for the displayed cancellation quote and its actual refunds. */
export function visitCancellationPolicy(
  scheduledAt: string,
  charges: VisitCharge[],
  terms: CleaningBillingTerms,
  now: Date | string = new Date(),
  contractAt?: string | null,
) {
  const hoursOnly = terms.cancellationBasis === "cleaning_hours";
  const bookingTotal = terms.cancellationBasis === "booking_total";
  const paid = charges.reduce(
    (sum, charge) => sum + charge.amount_pence - charge.refunded_pence,
    0,
  );
  const cleaning = hoursOnly
    ? charges.reduce(
        (sum, charge) =>
          sum +
          charge.line_items
            .filter((line) => line.id === "cleaning")
            .reduce(
              (total, line) =>
                total +
                Math.max(
                  0,
                  line.amountPence - (charge.refunded_lines[line.id] ?? 0),
                ),
              0,
            ),
        0,
      )
    : paid;
  let policy = calculateCancellationPolicy(
    scheduledAt,
    cleaning / 100,
    now,
    terms.cancellationRefundPercent,
    hoursOnly,
    bookingTotal,
  );
  const statutoryFree =
    (hoursOnly || bookingTotal) &&
    contractAt &&
    Number.isFinite(Date.parse(contractAt)) &&
    new Date(now).getTime() >= Date.parse(contractAt) &&
    new Date(now).getTime() < Date.parse(scheduledAt) &&
    new Date(now).getTime() < cancellationPeriodEnd(contractAt).getTime();
  if (statutoryFree)
    policy = {
      ...calculateCancellationPolicy(
        scheduledAt,
        cleaning / 100,
        now,
        { full: 100, three_quarter: 100, half: 100, none: 100 },
        true,
      ),
      title: "14-day cancellation right — full refund",
      explanation:
        "You are cancelling within your 14-day cancellation period before work has started. Your visit payment will be refunded in full.",
    };
  if (!hoursOnly) return policy;
  const refunds = cancellationRefunds(charges, policy.refundPercent, true);
  const refundPence = refunds.reduce(
    (sum, refund) => sum + refund.amountPence,
    0,
  );
  return {
    ...policy,
    refundPence,
    refundAmount: refundPence / 100,
    cancellationChargePence: paid - refundPence,
    cancellationCharge: (paid - refundPence) / 100,
    title: statutoryFree
      ? policy.title
      : `${100 - policy.refundPercent}% charge on cleaning hours only`,
    explanation: statutoryFree
      ? policy.explanation
      : `The cancellation charge is £${((paid - refundPence) / 100).toFixed(2)}, based on cleaning hours only. £${(refundPence / 100).toFixed(2)} of your visit payment will be refunded. Any tips are refunded separately in full. Staff can reduce the charge, and your cleaner can waive their compensation.`,
  };
}
