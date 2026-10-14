import type { VisitLine } from "./visitBillingPolicy";

export type VisitCharge = {
  id: string;
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
) {
  if (![0, 50, 75, 100].includes(refundPercent))
    throw new Error("Invalid refund percentage.");
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
