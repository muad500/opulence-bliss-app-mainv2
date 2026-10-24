import type { CleaningBillingTerms } from "./cleaningBillingTerms";
import type { VisitCharge } from "./visitAdjustments";

export type CleaningPayoutPart = {
  chargeId: string;
  intentId: string;
  amountPence: number;
};

export type CleaningPayoutAuditPart = {
  charge_id: string;
  amount_pence: number;
  reversed_pence: number;
  transfer_ref: string | null;
  destination_account: string | null;
};
export type CleaningPayoutAuditTransfer = {
  id: string;
  amount: number;
  amount_reversed: number;
  currency: string;
  destination: string | { id: string } | null;
  metadata: Record<string, string>;
};
/** Reconciliation counts all source transfers and their documented reversals,
 * not just the first reference displayed on the parent payout. */
export function auditCleaningPayout(
  bookingId: string,
  netPence: number,
  parts: CleaningPayoutAuditPart[],
  transfers: CleaningPayoutAuditTransfer[],
) {
  const issues: { transferId: string | null; reason: string }[] = [];
  let net = 0;
  for (const part of parts) {
    const transfer = transfers.find((row) => row.id === part.transfer_ref);
    if (!transfer) {
      issues.push({
        transferId: part.transfer_ref,
        reason: "Source transfer missing",
      });
      continue;
    }
    const destination =
      typeof transfer.destination === "string"
        ? transfer.destination
        : transfer.destination?.id;
    if (
      transfer.amount !== part.amount_pence ||
      transfer.amount_reversed !== part.reversed_pence ||
      transfer.currency !== "gbp" ||
      !part.destination_account ||
      destination !== part.destination_account ||
      transfer.metadata.booking_id !== bookingId ||
      transfer.metadata.charge_id !== part.charge_id
    )
      issues.push({
        transferId: transfer.id,
        reason:
          "Source transfer differs from its recorded amount, reversal, currency, destination or booking",
      });
    net += transfer.amount - transfer.amount_reversed;
  }
  if (net !== netPence)
    issues.push({
      transferId: null,
      reason: "Source transfers do not match the net parent payout",
    });
  return issues;
}

/** Allocate only money actually funded by each charge. A products payment made
 * later is a separate £4 component, never borrowed from an unrelated charge. */
export function cleaningPayoutParts(
  charges: VisitCharge[],
  terms: CleaningBillingTerms,
  cancellationCompensationPence?: number,
): CleaningPayoutPart[] {
  const parts: CleaningPayoutPart[] = [];
  let remaining = cancellationCompensationPence ?? 0;
  if (
    cancellationCompensationPence !== undefined &&
    (!Number.isSafeInteger(remaining) || remaining < 0)
  )
    throw new Error("Invalid cancellation compensation.");
  for (const charge of charges) {
    const cleaning = charge.line_items.find((line) => line.id === "cleaning");
    const products = charge.line_items.find((line) => line.id === "products");
    const net = charge.amount_pence - charge.refunded_pence;
    const cleaningRefunded = charge.refunded_lines.cleaning ?? 0;
    const cleaningRetained = Math.max(
      0,
      (cleaning?.amountPence ?? 0) - cleaningRefunded,
    );
    let amount: number;
    if (cancellationCompensationPence !== undefined) {
      amount = Math.min(remaining, cleaningRetained);
      remaining -= amount;
    } else {
      if (cleaningRefunded)
        throw new Error("A cleaning-hours refund needs payout review.");
      amount = Math.round(
        ((cleaning?.reservedMinutes ?? 0) * terms.cleanerHourlyPence) / 60,
      );
      if (
        products &&
        products.amountPence - (charge.refunded_lines.products ?? 0) >=
          terms.productsFeePence &&
        terms.productsFeePence > 0
      )
        amount += terms.productsCleanerPayPence ?? 0;
    }
    if (!Number.isSafeInteger(net) || net < 0 || amount > net)
      throw new Error(
        "Cleaner pay exceeds the settled funds on its source payment.",
      );
    if (amount > 0)
      parts.push({
        chargeId: charge.id,
        intentId: charge.stripe_payment_intent,
        amountPence: amount,
      });
  }
  if (cancellationCompensationPence !== undefined && remaining)
    throw new Error(
      "Cancellation compensation is not funded by retained cleaning hours.",
    );
  return parts;
}
