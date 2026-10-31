import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createVisitBilling } from "./visitBillingServer";
import {
  cancellationRefunds,
  visitCancellationPolicy,
  type VisitRefundPlan,
} from "./visitAdjustments";

export type SeriesAction = "pause" | "end";
export type SeriesVisitPlan = {
  id: string;
  scheduledAt: string;
  revision: number;
  cancel: boolean;
  refundPence: number;
  retainedPence: number;
  parameters: { refundPercent: number; refunds: VisitRefundPlan[] };
};

/** Preview and execution share exactly the same visit-level cancellation plan.
 * Confirmed visits cancel under their own policy; unpaid unassigned visits can
 * remain paused. Resuming never revives a cancelled visit or reverses its fee. */
export async function regularSeriesControlPlan(
  admin: SupabaseClient,
  engine: ReturnType<typeof createVisitBilling>,
  seriesId: string,
  customerId: string,
  action: SeriesAction,
  now = new Date(),
) {
  const series = await admin
    .from("regular_booking_series")
    .select("id,customer_id,billing_paused,pause_generation,ended_at")
    .eq("id", seriesId)
    .single();
  if (series.error || series.data?.customer_id !== customerId)
    throw new Error("Regular booking not found.");
  if (series.data.ended_at) throw new Error("This regular booking has ended.");
  const visits = await admin
    .from("bookings")
    .select("id")
    .eq("regular_series_id", seriesId)
    .in("status", ["offered", "declined", "scheduled"])
    .gt("scheduled_at", now.toISOString())
    .order("scheduled_at");
  if (visits.error) throw new Error("Visits could not be loaded.");
  const plan: SeriesVisitPlan[] = [];
  for (const row of visits.data ?? []) {
    const { booking, bill, charges, terms } = await engine.load(
      row.id,
      customerId,
    );
    if (
      bill.active_operation_id ||
      bill.policy_refund_required ||
      bill.status === "review"
    )
      throw new Error(
        "A visit payment is still processing or needs review. Please try again afterwards.",
      );
    const paid = charges.reduce(
      (sum, c) => sum + c.amount_pence - c.refunded_pence,
      0,
    );
    const cancel = action === "end" || Boolean(booking.provider_id) || paid > 0;
    const policy = visitCancellationPolicy(
      booking.scheduled_at,
      charges,
      terms,
      now,
      booking.created_at,
    );
    const refunds = cancel
      ? cancellationRefunds(
          charges,
          policy.refundPercent,
          terms.cancellationBasis === "cleaning_hours",
          terms.cancellationBasis === "booking_total",
        )
      : [];
    const refundPence = refunds.reduce((sum, r) => sum + r.amountPence, 0);
    plan.push({
      id: booking.id,
      scheduledAt: booking.scheduled_at,
      revision: bill.revision,
      cancel,
      refundPence,
      retainedPence: cancel ? paid - refundPence : 0,
      parameters: { refundPercent: policy.refundPercent, refunds },
    });
  }
  const result = {
    action,
    seriesId,
    generation: series.data.pause_generation,
    visits: plan,
    refundPence: plan.reduce((sum, r) => sum + r.refundPence, 0),
    retainedPence: plan.reduce((sum, r) => sum + r.retainedPence, 0),
  };
  return {
    ...result,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(result))
      .digest("hex"),
  };
}
