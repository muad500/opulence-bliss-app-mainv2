// Generated from the shared billing engine. Run npm run build:visit-worker.
// supabase/functions/visit-payments/handler.ts
import { timingSafeEqual } from "node:crypto";
import Stripe2 from "npm:stripe@22.3.2";
import { createClient } from "npm:@supabase/supabase-js@2.110.0";

// lib/visitBillingServer.ts
import Stripe from "npm:stripe@22.3.2";

// lib/cleaningBooking.ts
var CLEANING_DURATIONS = Array.from({ length: 13 }, (_, i) => 120 + i * 30);
function isCleaning(serviceType) {
  return (serviceType ?? "").toLowerCase().includes("clean");
}
function validCleaningDuration(minutes) {
  return (
    Number.isInteger(minutes) &&
    minutes >= 120 &&
    minutes <= 480 &&
    minutes % 30 === 0
  );
}
function bookingPricePence(pkg, minutes) {
  const baseMinutes = pkg.duration_minutes ?? 120;
  const price = Number(pkg.price);
  if (!Number.isFinite(price) || price <= 0 || baseMinutes <= 0) {
    throw new Error("This package needs a valid price and duration.");
  }
  if (isCleaning(pkg.service_type) && !validCleaningDuration(minutes)) {
    throw new Error(
      "Choose a cleaning duration from 2 to 8 hours in 30-minute steps.",
    );
  }
  return Math.round(
    price * 100 * (isCleaning(pkg.service_type) ? minutes / baseMinutes : 1),
  );
}

// lib/cleaningExtras.ts
var CLEANING_ADDONS = [
  { id: "oven", label: "Oven", pricePence: 2e3 },
  { id: "fridge", label: "Inside fridge", pricePence: 1e3 },
  { id: "cupboards", label: "Inside cupboards", pricePence: 1e3 },
  { id: "windows", label: "Interior windows", pricePence: 1500 },
  { id: "ironing", label: "Ironing", pricePence: 1500 },
];
var CLEANING_PRODUCTS_FEE_PENCE = 500;
function parseCleaningExtras(addons, bringsProducts) {
  if (
    !Array.isArray(addons) ||
    addons.some((id) => !CLEANING_ADDONS.some((item) => item.id === id)) ||
    new Set(addons).size !== addons.length
  ) {
    throw new Error("Choose each available add-on only once.");
  }
  if (typeof bringsProducts !== "boolean")
    throw new Error("Choose who brings cleaning products.");
  const selected = CLEANING_ADDONS.filter((item) => addons.includes(item.id));
  return {
    addons: selected,
    bringsProducts,
    addonPence: selected.reduce((sum, item) => sum + item.pricePence, 0),
    extraMinutes: selected.length * 60,
    productsPence: bringsProducts ? CLEANING_PRODUCTS_FEE_PENCE : 0,
  };
}
function cleaningQuote(pkg, baseMinutes, addons, bringsProducts, visits) {
  if (
    !validCleaningDuration(baseMinutes) ||
    !Number.isInteger(visits) ||
    (visits !== 1 && (visits < 6 || visits > 10))
  )
    throw new Error("Choose valid cleaning hours and visits.");
  const extras = parseCleaningExtras(addons, bringsProducts);
  const durationMinutes = baseMinutes + extras.extraMinutes;
  if (!validCleaningDuration(durationMinutes))
    throw new Error(
      "Cleaning and add-ons together must fit within 8 hours. Reduce cleaning hours or remove an add-on.",
    );
  const basePence = bookingPricePence(pkg, baseMinutes);
  const perVisitPence = basePence + extras.addonPence;
  return {
    ...extras,
    baseMinutes,
    durationMinutes,
    basePence,
    perVisitPence: perVisitPence + extras.productsPence,
    totalPence: (perVisitPence + extras.productsPence) * visits,
  };
}
function cleaningExtrasNotes(addons, bringsProducts, petsAtHome) {
  const extras = parseCleaningExtras(addons, bringsProducts);
  return [
    `Pets at home: ${petsAtHome ? "Yes" : "No"}`,
    `Cleaning products: ${bringsProducts ? "cleaner brings products (\xA35 per visit)" : "supplied by customer"}`,
    ...(extras.addons.length
      ? [
          `Add-ons: ${extras.addons.map((item) => `${item.label} (up to 1 hour)`).join(", ")}`,
        ]
      : []),
  ].join("\n");
}

// lib/visitBillingPolicy.ts
var VISIT_PAYMENT_DEADLINE_HOURS = 24;
var VISIT_CHANGE_NOTICE_HOURS = 24;
function unpaidVisitMustCancel(scheduledAt, now = Date.now()) {
  return (
    new Date(scheduledAt).getTime() - now <= VISIT_PAYMENT_DEADLINE_HOURS * 36e5
  );
}
function visitExtrasCanChange(scheduledAt, now = Date.now()) {
  return (
    new Date(scheduledAt).getTime() - now >= VISIT_CHANGE_NOTICE_HOURS * 36e5
  );
}
function assertVisitLines(lines) {
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    new Set(lines.map((line) => line.id)).size !== lines.length ||
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.amountPence) ||
        line.amountPence < 0 ||
        !Number.isInteger(line.reservedMinutes) ||
        line.reservedMinutes < 0,
    )
  )
    throw new Error("Invalid visit line items.");
  const duration = lines.reduce((sum, line) => sum + line.reservedMinutes, 0);
  if (duration < 120 || duration > 480 || duration % 30 !== 0)
    throw new Error("The full visit must fit within eight hours.");
}

// lib/visitLineItems.ts
function visitLineItems(quote, discountPence = 0) {
  if (
    !Number.isSafeInteger(discountPence) ||
    discountPence < 0 ||
    discountPence >= quote.basePence
  )
    throw new Error("Invalid visit discount.");
  const lines = [
    {
      id: "cleaning",
      label: "Cleaning",
      amountPence: quote.basePence - discountPence,
      reservedMinutes: quote.baseMinutes,
    },
  ];
  for (const addon of quote.addons)
    lines.push({
      id: addon.id,
      label: addon.label,
      amountPence: addon.pricePence,
      reservedMinutes: 60,
    });
  if (quote.bringsProducts)
    lines.push({
      id: "products",
      label: "Cleaner brings products",
      amountPence: quote.productsPence,
      reservedMinutes: 0,
    });
  assertVisitLines(lines);
  return lines;
}

// lib/cancellationPolicy.ts
var HOUR_MS = 60 * 60 * 1e3;
function pounds(pence) {
  return `\xA3${(pence / 100).toFixed(2)}`;
}
function londonDateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function calculateCancellationPolicy(
  scheduledAt,
  grossAmount,
  now = /* @__PURE__ */ new Date(),
) {
  const scheduledMs = new Date(scheduledAt).getTime();
  const nowMs = new Date(now).getTime();
  const hoursUntilBooking = (scheduledMs - nowMs) / HOUR_MS;
  const grossPence = Math.max(0, Math.round(Number(grossAmount || 0) * 100));
  const sameDay = londonDateKey(scheduledAt) === londonDateKey(now);
  const tier =
    hoursUntilBooking <= 0 || sameDay
      ? "none"
      : hoursUntilBooking >= 48
        ? "full"
        : hoursUntilBooking >= 24
          ? "three_quarter"
          : "half";
  const refundPercent =
    tier === "full"
      ? 100
      : tier === "three_quarter"
        ? 75
        : tier === "half"
          ? 50
          : 0;
  const refundPence = Math.round((grossPence * refundPercent) / 100);
  const cancellationChargePence = grossPence - refundPence;
  const title =
    tier === "full"
      ? "Full refund"
      : tier === "three_quarter"
        ? "75% refund"
        : tier === "half"
          ? "50% refund"
          : "No refund";
  const explanation =
    tier === "full"
      ? `This visit is at least 48 hours away. The full ${pounds(grossPence)} will be refunded or released.`
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

// lib/visitAdjustments.ts
function removedLineRefunds(charges, removed) {
  const remaining = new Map(removed.map((line) => [line.id, line.amountPence]));
  const refunds = [];
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
function cancellationRefunds(charges, refundPercent) {
  if (![0, 50, 75, 100].includes(refundPercent))
    throw new Error("Invalid refund percentage.");
  const paid = charges.reduce(
    (sum, charge) => sum + charge.amount_pence - charge.refunded_pence,
    0,
  );
  let remaining = Math.round((paid * refundPercent) / 100);
  const refunds = [];
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
function changedVisitLines(before, after) {
  const same = (a, b) => a.id === b.id && a.amountPence === b.amountPence;
  return {
    added: after.filter((line) => !before.some((old) => same(line, old))),
    removed: before.filter((line) => !after.some((next) => same(line, next))),
  };
}

// lib/visitBillingServer.ts
function must(result) {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null || result.data === void 0)
    throw new Error("Required payment record is missing.");
  return result.data;
}
function check(result) {
  if (result.error) throw new Error(result.error.message);
}
var idOf = (value) => (typeof value === "string" ? value : value?.id);
var paidTotal = (charges) =>
  charges.reduce((sum, c) => sum + c.amount_pence - c.refunded_pence, 0);
function createVisitBilling(admin, stripe) {
  async function load(bookingId, customerId) {
    const booking = must(
      await admin
        .from("bookings")
        .select(
          "id,customer_id,status,scheduled_at,provider_id,cleaning_extras,duration_minutes,household_notes",
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
    );
    return { booking, bill, charges };
  }
  async function quoteExtras(bookingId, customerId, input) {
    const { booking, bill, charges } = await load(bookingId, customerId);
    if (!visitExtrasCanChange(booking.scheduled_at))
      throw new Error("Add-on changes need at least 24 hours notice.");
    if (!["offered", "declined", "scheduled"].includes(booking.status))
      throw new Error("This visit is closed.");
    if (bill.active_operation_id)
      throw new Error("A payment change is still processing. Please wait.");
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
  async function prepare(bookingId, actor, type, revision, parameters) {
    return must(
      await admin.rpc("prepare_visit_money_operation", {
        p_booking: bookingId,
        p_actor: actor,
        p_type: type,
        p_revision: revision,
        p_parameters: parameters,
      }),
    );
  }
  async function changeExtras(bookingId, customerId, input) {
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
    bookingId,
    customerId,
    unfilled = false,
    expectedTier,
    latePayment = false,
  ) {
    const { booking, bill, charges } = await load(
      bookingId,
      customerId ?? void 0,
    );
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
        ),
      };
    const policy = calculateCancellationPolicy(
      booking.scheduled_at,
      paidTotal(charges) / 100,
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
  async function findIntent(op, customer) {
    for await (const intent of stripe.paymentIntents.list({
      customer,
      limit: 100,
    })) {
      if (intent.metadata.visit_operation === op.id) return intent;
      if (intent.created * 1e3 < new Date(op.created_at).getTime() - 3e5) break;
    }
    return null;
  }
  async function run(operationId) {
    const claim = await admin.rpc("claim_visit_money_operation", {
      p_operation: operationId,
    });
    check(claim);
    const claimed = claim.data;
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
    async function finish(outcome, error = null) {
      check(
        await admin.rpc("finish_visit_money_operation", {
          p_operation: op.id,
          p_outcome: outcome,
          p_results: results,
          p_error: error,
        }),
      );
    }
    try {
      const chargePence =
        op.operation_type === "charge"
          ? op.parameters.amountPence
          : (op.parameters.chargePence ?? 0);
      if (chargePence > 0) {
        let recorded = results.find((r) => r.type === "charge");
        let intent = recorded
          ? await stripe.paymentIntents.retrieve(recorded.id)
          : await findIntent(op, bill.stripe_customer_id);
        if (!intent) {
          if (Date.now() - new Date(op.created_at).getTime() >= 23 * 36e5)
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
              op.parameters.method,
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
          if (
            op.operation_type === "charge" &&
            unpaidVisitMustCancel(op.parameters.scheduledAt)
          ) {
            await stripe.paymentIntents.cancel(intent.id);
            recorded.status = "canceled";
            await finish("failed", "The visit reached its payment deadline.");
            return { status: "failed" };
          }
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
          if (Date.now() - new Date(op.created_at).getTime() >= 23 * 36e5)
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
      if (op.operation_type === "charge" && bill.deadline_missed)
        await cancel(op.booking_id, null, false, void 0, true);
      return { status: "succeeded" };
    } catch (error) {
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
  async function tick(limit = 50, bookingIds) {
    let activeQuery = admin
      .from("booking_visit_money_operations")
      .select("id,booking_id,operation_type")
      .in("status", ["prepared", "running", "ambiguous"])
      .or(
        `lease_until.is.null,lease_until.lte.${/* @__PURE__ */ new Date().toISOString()}`,
      )
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
    let dueQuery = admin
      .from("booking_visit_billing")
      .select("booking_id")
      .in("status", ["unpaid", "failed", "requires_action"])
      .lte("charge_due_at", /* @__PURE__ */ new Date().toISOString())
      .or(
        `retry_after.is.null,retry_after.lte.${/* @__PURE__ */ new Date().toISOString()},charge_due_at.lte.${new Date(Date.now() - 24 * 36e5).toISOString()}`,
      )
      .order("charge_due_at")
      .limit(limit);
    if (bookingIds) dueQuery = dueQuery.in("booking_id", bookingIds);
    const due = must(await dueQuery);
    for (const row of due) {
      const { booking, bill } = await load(row.booking_id);
      if (booking.status === "cancelled") continue;
      if (unpaidVisitMustCancel(booking.scheduled_at))
        await cancel(row.booking_id, null);
      else if (
        !bill.retry_after ||
        new Date(bill.retry_after).getTime() <= Date.now()
      ) {
        const operation = await prepare(
          row.booking_id,
          null,
          "charge",
          bill.revision,
          { amountPence: bill.amount_pence, lines: bill.line_items },
        );
        await run(operation.id);
      }
    }
    let unmatchedQuery = admin
      .from("bookings")
      .select("id")
      .eq("status", "offered")
      .is("provider_id", null)
      .lte("offer_expires_at", /* @__PURE__ */ new Date().toISOString())
      .limit(limit);
    if (bookingIds) unmatchedQuery = unmatchedQuery.in("id", bookingIds);
    const unmatched = must(await unmatchedQuery);
    for (const row of unmatched) {
      const { data: bill } = await admin
        .from("booking_visit_billing")
        .select("booking_id,active_operation_id")
        .eq("booking_id", row.id)
        .maybeSingle();
      if (bill && !bill.active_operation_id) await cancel(row.id, null, true);
    }
    check(
      await admin
        .from("visit_billing_runtime")
        .update({ last_scheduler_at: /* @__PURE__ */ new Date().toISOString() })
        .eq("id", true),
    );
    return { recovered: active.length, due: due.length };
  }
  return { load, quoteExtras, changeExtras, cancel, run, tick };
}

// supabase/functions/visit-payments/handler.ts
var targets = {
  staging: {
    project: "comwdjprdedmsnxtvuuk",
    stripeAccount: "acct_1UKQ4A2NzINBHbzj",
    keyPrefix: "sk_test_",
  },
  production: {
    project: "uiqcsihgqaktpjumyeap",
    stripeAccount: "acct_1UL6n3ILnegr7Mwu",
    keyPrefix: "sk_live_",
  },
};
function createVisitPaymentHandler(overrides = {}) {
  const deps = {
    env: (name) => Deno.env.get(name),
    admin: createClient,
    stripe: (key) =>
      new Stripe2(key, {
        httpClient: Stripe2.createFetchHttpClient(),
        timeout: 1e4,
        maxNetworkRetries: 1,
      }),
    tick: (admin, stripe) => createVisitBilling(admin, stripe).tick(5),
    ...overrides,
  };
  return async (request) => {
    if (request.method !== "POST")
      return Response.json({ error: "POST required" }, { status: 405 });
    const expected = deps.env("VISIT_PAYMENTS_CRON_SECRET") ?? "";
    const supplied = request.headers.get("x-visit-payments-secret") ?? "";
    const encoder = new TextEncoder();
    const left = encoder.encode(expected);
    const right = encoder.encode(supplied);
    if (
      left.length < 32 ||
      left.length !== right.length ||
      !timingSafeEqual(left, right)
    )
      return Response.json({ error: "Not authorised" }, { status: 401 });
    const mode = deps.env("VISIT_PAYMENTS_MODE");
    const target =
      mode === "staging" || mode === "production" ? targets[mode] : null;
    const url = deps.env("SUPABASE_URL");
    const key = deps.env("VISIT_PAYMENTS_STRIPE_SECRET_KEY");
    const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (
      deps.env("VISIT_PAYMENTS_ENABLED") !== "true" ||
      !target ||
      url !== `https://${target.project}.supabase.co` ||
      !serviceKey ||
      !key?.startsWith(target.keyPrefix)
    )
      return Response.json(
        { error: "Visit scheduler configuration is not ready" },
        { status: 503 },
      );
    try {
      const stripe = deps.stripe(key);
      const account = await stripe.accounts.retrieveCurrent();
      if (account.id !== target.stripeAccount)
        return Response.json(
          { error: "Visit scheduler account mismatch" },
          { status: 503 },
        );
      const admin = deps.admin(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const result = await deps.tick(admin, stripe);
      return Response.json({
        ok: true,
        mode,
        source:
          "f819aba1c1e1fa234d1f199dd087e8fb63ce2db85a247adfe8aae5f235ae797c",
        result,
      });
    } catch {
      console.error(
        "Visit payment scheduler failed; review its operation ledger.",
      );
      return Response.json(
        { error: "Visit scheduler will retry" },
        { status: 503 },
      );
    }
  };
}
Deno.serve(createVisitPaymentHandler());
export { createVisitPaymentHandler };
