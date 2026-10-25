import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingCleaningBillingTerms } from "./cleaningBillingSettings";
import { cleaningPayoutParts } from "./cleaningSettlement";
import type { VisitCharge } from "./visitAdjustments";
import { assignedProviderDestination } from "./payoutDestination";
import {
  claimMoneyOperation,
  systemFinaliseMoneyOperation,
  systemTransitionPayout,
} from "./bookingState";

type PlannedPart = {
  charge_id: string;
  amount_pence: number;
  reversed_pence: number;
  transfer_ref: string | null;
  operation_key: string;
};
type Plan = {
  ready: boolean;
  settled?: boolean;
  amountPence: number;
  payoutId?: string;
  parts?: PlannedPart[];
};
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
function requireData<T>(result: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (result.error || result.data == null)
    throw new Error(
      result.error?.message ?? "Cleaning settlement record missing.",
    );
  return result.data as NonNullable<T>;
}

/** New launch bookings only. Each transfer has its own captured source, durable
 * money-operation key and checkpoint. Legacy bookings keep their prior engine. */
export function createCleaningSettlement(
  admin: SupabaseClient,
  stripe: Stripe,
) {
  async function settle(bookingId: string, requestedBy?: string) {
    const booking = requireData(
      await admin
        .from("bookings")
        .select("status,provider_id,customer_id")
        .eq("id", bookingId)
        .single(),
    );
    const terms = await bookingCleaningBillingTerms(admin, bookingId);
    if (terms.productsCleanerPayPence === undefined)
      throw new Error("A launch cleaning booking is required.");
    const charges = requireData(
      await admin
        .from("booking_visit_charges")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at"),
    ) as VisitCharge[];
    let compensation: number | undefined;
    if (booking.status === "cancelled") {
      const row = requireData(
        await admin
          .from("cleaning_cancellation_settlements")
          .select("cleaner_pay_pence,provider_id")
          .eq("booking_id", bookingId)
          .single(),
      );
      compensation = row.cleaner_pay_pence;
      if (row.provider_id !== booking.provider_id)
        throw new Error("The cancellation's assigned cleaner changed.");
    }
    const parts = cleaningPayoutParts(charges, terms, compensation);
    const plan = requireData(
      await admin.rpc("prepare_cleaning_payout", {
        p_booking: bookingId,
        p_parts: parts,
      }),
    ) as Plan;
    if (!plan.ready)
      return {
        earned: plan.amountPence / 100,
        payoutSettled: plan.settled === true,
      };
    const payoutId = plan.payoutId!;
    async function hold(reason: string) {
      const state = requireData(
        await admin
          .from("payouts")
          .select("status")
          .eq("id", payoutId)
          .single(),
      );
      if (state.status !== "paid" && state.status !== "held")
        await systemTransitionPayout(admin, payoutId, "held", { reason });
      const review = await admin.rpc("open_review_case", {
        p_booking_id: bookingId,
        p_category: "payout_failure",
        p_priority: "high",
        p_blocks_payment: false,
        p_blocks_payout: true,
        p_notes: reason,
        p_created_by: requestedBy ?? null,
      });
      if (review.error) throw new Error(review.error.message);
      return { earned: plan.amountPence / 100, payoutSettled: false };
    }
    const provider = requireData(
      await admin
        .from("providers")
        .select("stripe_account_id,profile_id")
        .eq("id", booking.provider_id)
        .single(),
    );
    if (provider.profile_id === booking.customer_id)
      return hold("Self-booking cannot receive a cleaner payout");
    const destination = assignedProviderDestination(provider.stripe_account_id);
    if (!destination) return hold("Provider payout account is not configured");
    let firstTransfer: string | null = null;
    for (const part of plan.parts ?? []) {
      if (part.transfer_ref) {
        firstTransfer ??= part.transfer_ref;
        continue;
      }
      const funded = parts.find((source) => source.chargeId === part.charge_id);
      if (
        !funded ||
        funded.amountPence !== part.amount_pence ||
        part.reversed_pence
      )
        return hold("Cleaner payout source changed and needs reconciliation");
      const intent = await stripe.paymentIntents.retrieve(funded.intentId);
      if (
        intent.status !== "succeeded" ||
        intent.currency !== "gbp" ||
        intent.transfer_data ||
        !intent.latest_charge ||
        (intent.metadata.booking_id && intent.metadata.booking_id !== bookingId)
      )
        return hold(
          "The cleaner payout source is not a settled platform charge",
        );
      const source = idOf(intent.latest_charge)!;
      const charge = await stripe.charges.retrieve(source);
      if (
        charge.disputed ||
        charge.amount - charge.amount_refunded < part.amount_pence
      )
        return hold("The captured payment needs review before cleaner payout");
      const operation = await claimMoneyOperation(admin, {
        operationKey: part.operation_key,
        operationType: "transfer",
        bookingId,
        amount: part.amount_pence / 100,
        requestedBy,
      });
      let transferId = operation.stripe_object_id;
      if (operation.status === "succeeded") {
        if (!transferId)
          return hold(
            "A completed cleaner transfer is missing its Stripe reference",
          );
        const transfer = await stripe.transfers.retrieve(transferId);
        if (
          idOf(transfer.destination) !== destination ||
          transfer.amount !== part.amount_pence ||
          idOf(transfer.source_transaction) !== source
        )
          return hold(
            "The recorded cleaner transfer differs from its source allocation",
          );
      } else {
        if (!operation.should_run)
          return hold(
            "A cleaner transfer needs reconciliation; do not send another",
          );
        try {
          const transfer = await stripe.transfers.create(
            {
              amount: part.amount_pence,
              currency: "gbp",
              destination,
              source_transaction: source,
              transfer_group:
                intent.transfer_group ?? `ob_booking_${bookingId}`,
              metadata: {
                kind: "cleaning_visit_payout",
                booking_id: bookingId,
                charge_id: part.charge_id,
                operation_key: part.operation_key,
              },
            },
            { idempotencyKey: part.operation_key },
          );
          transferId = transfer.id;
          // Commit Stripe's durable fact BEFORE recording the local part.
          await systemFinaliseMoneyOperation(admin, operation.id, "succeeded", {
            stripeObjectId: transferId,
          });
        } catch (error) {
          const definite =
            error instanceof Stripe.errors.StripeInvalidRequestError;
          await systemFinaliseMoneyOperation(
            admin,
            operation.id,
            definite ? "failed" : "ambiguous",
            { error: "Cleaner source transfer needs reconciliation" },
          ).catch(() => undefined);
          return hold("Cleaner source transfer needs reconciliation");
        }
      }
      const saved = await admin
        .from("cleaning_payout_parts")
        .update({ transfer_ref: transferId, destination_account: destination })
        .eq("charge_id", part.charge_id)
        .is("transfer_ref", null);
      if (saved.error)
        throw new Error("The cleaner transfer checkpoint needs recovery.");
      firstTransfer ??= transferId ?? null;
    }
    const saved = await admin
      .from("payouts")
      .update({ stripe_transfer_ref: firstTransfer })
      .eq("id", payoutId);
    if (saved.error) throw new Error("The payout reference needs recovery.");
    await systemTransitionPayout(admin, payoutId, "paid");
    if (booking.status === "cancelled") {
      const result = await admin
        .from("cleaning_cancellation_settlements")
        .update({ payout_settled_at: new Date().toISOString() })
        .eq("booking_id", bookingId);
      if (result.error)
        throw new Error("The cancellation payout checkpoint needs recovery.");
    }
    return { earned: plan.amountPence / 100, payoutSettled: true };
  }
  return { settle };
}
