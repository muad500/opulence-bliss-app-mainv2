import { bookingCleaningBillingTerms } from "./cleaningBillingSettings";
import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleaningQuote, cleaningExtrasNotes } from "./cleaningExtras";
import { visitLineItems } from "./visitLineItems";
import {
  calculateCancellationPolicy,
  type CancellationPolicyTier,
} from "./cancellationPolicy";
import {
  changedVisitLines,
  cancellationRefunds,
  removedLineRefunds,
  type VisitCharge,
  type VisitRefundPlan,
} from "./visitAdjustments";
import { visitExtrasCanChange, type VisitLine } from "./visitBillingPolicy";
import {
  assignedPaymentMustCancel,
  type ChargeEligibility,
} from "./visitMatchingPolicy";

type MoneyResult = {
  type: "charge" | "refund";
  id: string;
  status: string;
  amountPence: number;
  lines?: VisitLine[];
  chargeId?: string;
  refundedLines?: Record<string, number>;
};
type Operation = {
  id: string;
  booking_id: string;
  operation_type: string;
  revision: number;
  idempotency_key: string;
  created_at: string;
  stripe_objects: MoneyResult[];
  parameters: {
    amountPence?: number;
    chargePence?: number;
    lines?: VisitLine[];
    added?: VisitLine[];
    refunds?: VisitRefundPlan[];
    oldStatus: string;
    method?: string;
    scheduledAt: string;
  };
};

function must<T>(result: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === undefined)
    throw new Error("Required payment record is missing.");
  return result.data as NonNullable<T>;
}
function check(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;
const paidTotal = (charges: VisitCharge[]) =>
  charges.reduce((sum, c) => sum + c.amount_pence - c.refunded_pence, 0);

export function createVisitBilling(admin: SupabaseClient, stripe: Stripe) {
  async function load(bookingId: string, customerId?: string) {
    const booking = must(
      await admin
        .from("bookings")
        .select(
          "id,customer_id,status,scheduled_at,provider_id,regular_series_id,cleaning_extras,duration_minutes,household_notes",
        )
        .eq("id", bookingId)
        .single(),
    );
    if (customerId && booking.customer_id !== customerId)
      throw new Error("Not your booking.");
    const bill = must(
      await admin
        .from("booking_visit_billing")
        .select("*")
        .eq("booking_id", bookingId)
        .single(),
    );
    const charges = must(
      await admin
        .from("booking_visit_charges")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at"),
    ) as VisitCharge[];
    const terms = await bookingCleaningBillingTerms(admin, bookingId);
    return { booking, bill, charges, terms };
  }

  async function chargeGate(
    bookingId: string,
    operationId: string | null = null,
    kind = "charge",
  ) {
    return must(
      await admin.rpc("visit_charge_gate", {
        p_booking: bookingId,
        p_operation: operationId,
        p_kind: kind,
      }),
    ) as ChargeEligibility;
  }

  async function refundBlockedPayment(bookingId: string) {
    const { bill, charges } = await load(bookingId);
    if (!bill.policy_refund_required || bill.active_operation_id) return;
    const sourceCharges = charges.filter(
      (charge) => charge.operation_id === bill.blocked_charge_operation,
    );
    const operation = await prepare(
      bookingId,
      null,
      "policy_refund",
      bill.revision,
      {
        refundPercent: 100,
        refunds: cancellationRefunds(sourceCharges, 100),
      },
    );
    await run(operation.id);
  }

  async function chargeVisit(bookingId: string) {
    const { booking, bill } = await load(bookingId);
    if (bill.policy_refund_required) {
      await refundBlockedPayment(bookingId);
      return { status: "processing" };
    }
    if (!["unpaid", "failed", "requires_action"].includes(bill.status))
      return { status: bill.status };
    const gate = await chargeGate(bookingId);
    if (gate.paused || !gate.assigned) return { status: "blocked" };
    if (
      assignedPaymentMustCancel(
        booking.scheduled_at,
        gate.assigned,
        bill.attempts,
        Date.now(),
        bill.late_payment_grace_until,
      )
    )
      return cancel(bookingId, null);
    if (
      !gate.allowed ||
      (bill.retry_after && new Date(bill.retry_after).getTime() > Date.now())
    )
      return { status: "blocked" };
    try {
      const operation = await prepare(
        bookingId,
        null,
        "charge",
        bill.revision,
        {
          amountPence: bill.amount_pence,
          lines: bill.line_items,
        },
      );
      const result = await run(operation.id);
      if (result.status === "failed") {
        const refreshed = await load(bookingId);
        if (
          assignedPaymentMustCancel(
            refreshed.booking.scheduled_at,
            refreshed.booking.provider_id !== null,
            refreshed.bill.attempts,
            Date.now(),
            refreshed.bill.late_payment_grace_until,
          )
        )
          await cancel(bookingId, null);
      }
      return result;
    } catch (error) {
      // A pause or withdrawal may win after the due batch was selected.
      if (
        error instanceof Error &&
        error.message.startsWith("VISIT_CHARGE_BLOCKED:")
      )
        return { status: "blocked" };
      throw error;
    }
  }

  async function quoteExtras(
    bookingId: string,
    customerId: string,
    input: { addons: unknown; bringsProducts: unknown },
  ) {
    const { booking, bill, charges, terms } = await load(bookingId, customerId);
    if (!visitExtrasCanChange(booking.scheduled_at))
      throw new Error("Add-on changes need at least 24 hours notice.");
    if (!["offered", "declined", "scheduled"].includes(booking.status))
      throw new Error("This visit is closed.");
    if (bill.active_operation_id)
      throw new Error("A payment change is still processing. Please wait.");
    if (bill.status === "review" || bill.policy_refund_required)
      throw new Error(
        "Your visit payment needs a team review before further changes.",
      );
    const previous = booking.cleaning_extras;
    const quote = cleaningQuote(
      {
        price: bill.base_pence / 100,
        duration_minutes: previous.baseMinutes,
        service_type: "cleaning",
      },
      previous.baseMinutes,
      input.addons,
      input.bringsProducts,
      1,
      terms,
    );
    const lines = visitLineItems(quote, bill.discount_pence);
    const { added, removed } = changedVisitLines(bill.line_items, lines);
    const wasPaid = bill.status === "paid";
    const refunds = wasPaid ? removedLineRefunds(charges, removed) : [];
    const chargePence = wasPaid
      ? added.reduce((sum, line) => sum + line.amountPence, 0)
      : 0;
    const scope = {
      ...previous,
      addons: quote.addons.map((addon) => addon.id),
      bringsProducts: quote.bringsProducts,
      durationMinutes: quote.durationMinutes,
      grossPence: quote.totalPence,
      netPence: quote.totalPence - bill.discount_pence,
      lineItems: lines,
      notes: cleaningExtrasNotes(
        quote.addons.map((a) => a.id),
        quote.bringsProducts,
        previous.petsAtHome,
        terms,
      ),
    };
    return {
      revision: bill.revision,
      amountPence: scope.netPence,
      chargePence,
      refundPence: refunds.reduce((sum, refund) => sum + refund.amountPence, 0),
      durationMinutes: quote.durationMinutes,
      lines,
      scope,
      refunds,
      added,
      changed: added.length > 0 || removed.length > 0,
    };
  }

  async function prepare(
    bookingId: string,
    actor: string | null,
    type: string,
    revision: number,
    parameters: unknown,
  ) {
    return must(
      await admin.rpc("prepare_visit_money_operation", {
        p_booking: bookingId,
        p_actor: actor,
        p_type: type,
        p_revision: revision,
        p_parameters: parameters,
      }),
    ) as Operation;
  }

  async function changeExtras(
    bookingId: string,
    customerId: string,
    input: {
      addons: unknown;
      bringsProducts: unknown;
      revision: number;
      chargePence: number;
      refundPence: number;
    },
  ) {
    const quote = await quoteExtras(bookingId, customerId, input);
    if (
      input.revision !== quote.revision ||
      input.chargePence !== quote.chargePence ||
      input.refundPence !== quote.refundPence
    )
      throw new Error("The price changed. Review it and confirm again.");
    if (!quote.changed) return { status: "succeeded" };
    const operation = await prepare(
      bookingId,
      customerId,
      "extras",
      quote.revision,
      quote,
    );
    return run(operation.id);
  }

  async function cancel(
    bookingId: string,
    customerId: string | null,
    unfilled = false,
    expectedTier?: CancellationPolicyTier,
    latePayment = false,
  ) {
    const { booking, bill, charges, terms } = await load(
      bookingId,
      customerId ?? undefined,
    );
    if (unfilled && (await chargeGate(bookingId)).paused)
      return {
        status: "blocked",
        policy: calculateCancellationPolicy(
          booking.scheduled_at,
          paidTotal(charges) / 100,
          new Date(),
          terms.cancellationRefundPercent,
        ),
      };
    if (
      booking.status === "cancelled" &&
      !bill.active_operation_id &&
      !latePayment
    )
      return {
        status: "succeeded",
        policy: calculateCancellationPolicy(
          booking.scheduled_at,
          paidTotal(charges) / 100,
          new Date(),
          terms.cancellationRefundPercent,
        ),
      };
    const policy = calculateCancellationPolicy(
      booking.scheduled_at,
      paidTotal(charges) / 100,
      new Date(),
      terms.cancellationRefundPercent,
    );
    if (expectedTier && expectedTier !== policy.tier)
      throw new Error(
        "The cancellation window changed. Review the updated refund before confirming.",
      );
    const refundPercent =
      unfilled || latePayment
        ? 100
        : customerId === null
          ? 0
          : policy.refundPercent;
    const operation = await prepare(
      bookingId,
      customerId,
      latePayment ? "late_refund" : unfilled ? "unfilled" : "cancel",
      bill.revision,
      {
        refundPercent,
        refunds: cancellationRefunds(charges, refundPercent),
        latePayment,
      },
    );
    return { ...(await run(operation.id)), policy };
  }

  async function findIntent(op: Operation, customer: string) {
    for await (const intent of stripe.paymentIntents.list({
      customer,
      limit: 100,
    })) {
      if (intent.metadata.visit_operation === op.id) return intent;
      if (intent.created * 1000 < new Date(op.created_at).getTime() - 300_000)
        break;
    }
    return null;
  }

  async function run(operationId: string) {
    const claim = await admin.rpc("claim_visit_money_operation", {
      p_operation: operationId,
    });
    check(claim);
    const claimed = claim.data as Operation | null;
    if (!claimed) {
      const saved = must(
        await admin
          .from("booking_visit_money_operations")
          .select("status")
          .eq("id", operationId)
          .single(),
      );
      return {
        status:
          saved.status === "succeeded"
            ? "succeeded"
            : saved.status === "failed"
              ? "failed"
              : "processing",
      };
    }
    const op = claimed;
    const { bill } = await load(op.booking_id);
    const results = [...op.stripe_objects];
    async function checkpoint() {
      check(
        await admin
          .from("booking_visit_money_operations")
          .update({ stripe_objects: results, parameters: op.parameters })
          .eq("id", op.id),
      );
    }
    async function finish(outcome: string, error: string | null = null) {
      check(
        await admin.rpc("finish_visit_money_operation", {
          p_operation: op.id,
          p_outcome: outcome,
          p_results: results,
          p_error: error,
        }),
      );
    }
    async function stopBlockedCharge(intent: Stripe.PaymentIntent | null) {
      const gate = await chargeGate(op.booking_id, op.id, op.operation_type);
      if (gate.allowed || intent?.status === "succeeded") return null;
      if (intent?.status === "processing") {
        await finish("ambiguous", "Blocked charge is still being reconciled.");
        return { status: "processing" };
      }
      if (intent && intent.status !== "canceled") {
        await stripe.paymentIntents.cancel(intent.id);
        const recorded = results.find((result) => result.id === intent.id);
        if (recorded) recorded.status = "canceled";
      }
      await finish(
        "blocked",
        `Charge blocked: ${gate.reason ?? "visit changed"}`,
      );
      return { status: "blocked" };
    }
    try {
      const chargePence =
        op.operation_type === "charge"
          ? op.parameters.amountPence!
          : (op.parameters.chargePence ?? 0);
      if (chargePence > 0) {
        let recorded = results.find((r) => r.type === "charge");
        let intent = recorded
          ? await stripe.paymentIntents.retrieve(recorded.id)
          : await findIntent(op, bill.stripe_customer_id);
        const blocked = await stopBlockedCharge(intent);
        if (blocked) return blocked;
        if (!intent) {
          // Stripe may prune an idempotency key after 24h. An unknown old
          // creation must be reviewed, never replayed as another charge.
          if (Date.now() - new Date(op.created_at).getTime() >= 23 * 3_600_000)
            throw new Error(
              "Unknown old Stripe operation requires reconciliation.",
            );
          if (!op.parameters.method) {
            const customer = await stripe.customers.retrieve(
              bill.stripe_customer_id,
            );
            if (customer.deleted)
              throw new Stripe.errors.StripeInvalidRequestError({
                message: "Saved billing account is unavailable.",
              });
            op.parameters.method =
              idOf(customer.invoice_settings.default_payment_method) ??
              bill.stripe_payment_method_id;
            const method = await stripe.paymentMethods.retrieve(
              op.parameters.method!,
            );
            if (
              method.type !== "card" ||
              idOf(method.customer) !== bill.stripe_customer_id
            )
              throw new Stripe.errors.StripeInvalidRequestError({
                message: "Update your saved card.",
              });
            await checkpoint();
          }
          intent = await stripe.paymentIntents.create(
            {
              amount: chargePence,
              currency: "gbp",
              customer: bill.stripe_customer_id,
              payment_method: op.parameters.method,
              payment_method_types: ["card"],
              capture_method: "automatic",
              metadata: {
                kind: "visit_charge",
                booking_id: op.booking_id,
                visit_operation: op.id,
              },
            },
            { idempotencyKey: `${op.idempotency_key}:create` },
          );
        }
        if (!recorded) {
          recorded = {
            type: "charge",
            id: intent.id,
            status: intent.status,
            amountPence: chargePence,
            lines:
              op.operation_type === "charge"
                ? op.parameters.lines
                : op.parameters.added,
          };
          results.push(recorded);
          // Persist the ID BEFORE confirm: a lost response cannot cause a
          // second charged intent; retries retrieve this exact object.
          await checkpoint();
        }
        if (
          intent.amount !== chargePence ||
          intent.currency !== "gbp" ||
          idOf(intent.customer) !== bill.stripe_customer_id ||
          intent.metadata.visit_operation !== op.id ||
          intent.transfer_data?.destination
        )
          throw new Error(
            "Stripe payment does not match the prepared operation.",
          );
        if (intent.status === "requires_confirmation") {
          const blockedBeforeConfirm = await stopBlockedCharge(intent);
          if (blockedBeforeConfirm) return blockedBeforeConfirm;
          intent = await stripe.paymentIntents.confirm(
            intent.id,
            { off_session: true },
            { idempotencyKey: `${op.idempotency_key}:confirm` },
          );
        }
        recorded.status = intent.status;
        if (
          ["requires_payment_method", "requires_action", "canceled"].includes(
            intent.status,
          )
        ) {
          if (intent.status !== "canceled")
            await stripe.paymentIntents.cancel(intent.id);
          await finish(
            "failed",
            "Update your saved card; the payment was not completed.",
          );
          return { status: "failed" };
        }
        if (
          intent.status !== "succeeded" ||
          intent.amount_received !== chargePence
        )
          throw new Error("Stripe payment is still processing.");
        await checkpoint();
      }
      for (const [index, plan] of (op.parameters.refunds ?? []).entries()) {
        if (
          results.some(
            (r) => r.type === "refund" && r.chargeId === plan.chargeId,
          )
        )
          continue;
        const existing = await stripe.refunds.list({
          payment_intent: plan.intentId,
          limit: 100,
        });
        let refund = existing.data.find(
          (r) =>
            r.metadata?.visit_operation === op.id &&
            r.metadata?.visit_step === String(index),
        );
        if (!refund) {
          if (Date.now() - new Date(op.created_at).getTime() >= 23 * 3_600_000)
            throw new Error("Unknown old refund requires reconciliation.");
          refund = await stripe.refunds.create(
            {
              payment_intent: plan.intentId,
              amount: plan.amountPence,
              metadata: {
                visit_operation: op.id,
                visit_step: String(index),
                booking_id: op.booking_id,
              },
            },
            { idempotencyKey: `${op.idempotency_key}:refund:${index}` },
          );
        }
        if (
          refund.amount !== plan.amountPence ||
          idOf(refund.payment_intent) !== plan.intentId ||
          refund.status !== "succeeded"
        )
          throw new Error(
            "Stripe refund is still processing or needs attention.",
          );
        results.push({
          type: "refund",
          id: refund.id,
          status: refund.status,
          amountPence: plan.amountPence,
          chargeId: plan.chargeId,
          refundedLines: plan.refundedLines,
        });
        await checkpoint();
      }
      await finish("succeeded");
      if (op.operation_type === "charge" || op.operation_type === "extras") {
        const current = await load(op.booking_id);
        if (current.bill.policy_refund_required)
          await refundBlockedPayment(op.booking_id);
        else if (op.operation_type === "charge" && current.bill.deadline_missed)
          await cancel(op.booking_id, null, false, undefined, true);
      }
      return { status: "succeeded" };
    } catch (error) {
      // Once any successful Stripe effect exists, keep recovering the SAME
      // operation. Never roll back scope or start another payment blindly.
      const definite =
        error instanceof Stripe.errors.StripeCardError ||
        error instanceof Stripe.errors.StripeInvalidRequestError;
      const hasMoney = results.some((r) => r.status === "succeeded");
      if (definite && !hasMoney && !results.some((r) => r.type === "refund")) {
        const charge = results.find((r) => r.type === "charge");
        if (charge) {
          const intent = await stripe.paymentIntents
            .retrieve(charge.id)
            .catch(() => null);
          if (
            !intent ||
            ![
              "requires_payment_method",
              "requires_action",
              "canceled",
            ].includes(intent.status)
          ) {
            await finish("ambiguous", "Stripe outcome needs reconciliation.");
            return { status: "processing" };
          }
          if (intent.status !== "canceled")
            await stripe.paymentIntents.cancel(intent.id);
        }
        await finish(
          "failed",
          "Update your saved card; the payment was not completed.",
        );
        return { status: "failed" };
      }
      await finish(
        "ambiguous",
        "Stripe outcome needs reconciliation; do not pay again.",
      );
      return { status: "processing" };
    }
  }

  async function tick(limit = 50, bookingIds?: string[]) {
    let activeQuery = admin
      .from("booking_visit_money_operations")
      .select("id,booking_id,operation_type")
      .in("status", ["prepared", "running", "ambiguous"])
      .or(`lease_until.is.null,lease_until.lte.${new Date().toISOString()}`)
      .order("created_at")
      .limit(limit);
    if (bookingIds) activeQuery = activeQuery.in("booking_id", bookingIds);
    const active = must(await activeQuery);
    for (const op of active) {
      if (op.operation_type === "charge")
        check(
          await admin.rpc("mark_visit_payment_deadline", {
            p_booking: op.booking_id,
          }),
        );
      await run(op.id);
    }
    let refundQuery = admin
      .from("booking_visit_billing")
      .select("booking_id")
      .eq("policy_refund_required", true)
      .is("active_operation_id", null)
      .limit(limit);
    if (bookingIds) refundQuery = refundQuery.in("booking_id", bookingIds);
    for (const row of must(await refundQuery))
      await refundBlockedPayment(row.booking_id);
    check(await admin.rpc("queue_due_visit_matching_notices"));
    // Expiry is part of this scheduler too, so a separate old hold cron is
    // not required for the new payment model.
    let unmatchedQuery = admin
      .from("bookings")
      .select("id,scheduled_at,optional_scheduled_at")
      .eq("status", "offered")
      .is("provider_id", null)
      .lte("offer_expires_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(limit);
    if (bookingIds) unmatchedQuery = unmatchedQuery.in("id", bookingIds);
    const unmatched = must(await unmatchedQuery);
    for (const row of unmatched) {
      const matchingDeadlineReached = [
        row.scheduled_at,
        ...(row.optional_scheduled_at ?? []),
      ].some((slot) => new Date(slot).getTime() <= Date.now() + 2 * 3_600_000);
      // An old offer expiry alone must never cancel a future visit early.
      if (!matchingDeadlineReached) continue;
      const { data: bill } = await admin
        .from("booking_visit_billing")
        .select("booking_id,active_operation_id")
        .eq("booking_id", row.id)
        .maybeSingle();
      if (
        bill &&
        !bill.active_operation_id &&
        !(await chargeGate(row.id)).paused
      )
        await cancel(row.id, null, true);
    }
    const due = must(
      await admin.rpc("due_assigned_visit_payments", {
        p_limit: limit,
        p_bookings: bookingIds ?? null,
      }),
    ) as { booking_id: string }[];
    for (const row of due) await chargeVisit(row.booking_id);
    check(
      await admin
        .from("visit_billing_runtime")
        .update({ last_scheduler_at: new Date().toISOString() })
        .eq("id", true),
    );
    return { recovered: active.length, due: due.length };
  }
  return {
    load,
    quoteExtras,
    changeExtras,
    cancel,
    chargeVisit,
    chargeGate,
    run,
    tick,
  };
}
