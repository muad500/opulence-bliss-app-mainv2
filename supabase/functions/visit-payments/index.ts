// Generated from the shared billing engine. Run npm run build:visit-worker.
// supabase/functions/visit-payments/handler.ts
import { timingSafeEqual } from "node:crypto";
import Stripe2 from "npm:stripe@22.3.2";
import { createClient } from "npm:@supabase/supabase-js@2.110.0";

// lib/cleaningBillingTerms.ts
var CLEANING_ADDON_IDS = ["oven", "fridge", "cupboards", "windows", "ironing"];
var DEFAULT_CLEANING_BILLING_TERMS = {
  version: "legacy-default",
  cleanerHourlyPence: 1500,
  addonPrices: {
    oven: 2e3,
    fridge: 1e3,
    cupboards: 1e3,
    windows: 1500,
    ironing: 1500,
  },
  productsFeePence: 500,
  tipMinimumPence: 300,
  cancellationRefundPercent: {
    full: 100,
    three_quarter: 75,
    half: 50,
    none: 0,
  },
};
function parseCleaningBillingTerms(value) {
  if (!value || typeof value !== "object")
    throw new Error("Billing settings are missing.");
  const source = value;
  const money = (amount, max, minimum = 0) => {
    if (
      !Number.isSafeInteger(amount) ||
      Number(amount) < minimum ||
      Number(amount) > max
    )
      throw new Error("Enter a valid amount with at most two decimal places.");
    return Number(amount);
  };
  if (typeof source.version !== "string" || source.version.length > 100)
    throw new Error("Billing settings version is missing.");
  const refunds = source.cancellationRefundPercent;
  if (
    !refunds ||
    !CLEANING_ADDON_IDS.every((id) => source.addonPrices?.[id] !== void 0)
  )
    throw new Error("Complete every price and cancellation band.");
  const percentages = [
    refunds.full,
    refunds.three_quarter,
    refunds.half,
    refunds.none,
  ];
  percentages.forEach((percent) => money(percent, 100));
  if (
    percentages.some(
      (percent, index) => index > 0 && percent > percentages[index - 1],
    )
  )
    throw new Error(
      "Refund percentages must not increase closer to the visit.",
    );
  return {
    version: source.version,
    cleanerHourlyPence: money(source.cleanerHourlyPence, 1e4, 1),
    addonPrices: Object.fromEntries(
      CLEANING_ADDON_IDS.map((id) => [id, money(source.addonPrices[id], 5e4)]),
    ),
    productsFeePence: money(source.productsFeePence, 1e4),
    tipMinimumPence: money(source.tipMinimumPence, 1e4, 50),
    cancellationRefundPercent: { ...refunds },
  };
}

// lib/cleaningBillingSettings.ts
async function bookingCleaningBillingTerms(admin, bookingId) {
  const { data, error } = await admin
    .from("booking_cleaning_billing_terms")
    .select("terms")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw new Error("Could not load the agreed booking terms.");
  return data
    ? parseCleaningBillingTerms(data.terms)
    : DEFAULT_CLEANING_BILLING_TERMS;
}

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
function parseCleaningExtras(
  addons,
  bringsProducts,
  prices = DEFAULT_CLEANING_BILLING_TERMS,
) {
  if (
    !Array.isArray(addons) ||
    addons.some((id) => !CLEANING_ADDONS.some((item) => item.id === id)) ||
    new Set(addons).size !== addons.length
  ) {
    throw new Error("Choose each available add-on only once.");
  }
  if (typeof bringsProducts !== "boolean")
    throw new Error("Choose who brings cleaning products.");
  const selected = CLEANING_ADDONS.filter((item) =>
    addons.includes(item.id),
  ).map((item) => ({ ...item, pricePence: prices.addonPrices[item.id] }));
  return {
    addons: selected,
    bringsProducts,
    addonPence: selected.reduce((sum, item) => sum + item.pricePence, 0),
    extraMinutes: selected.length * 60,
    productsPence: bringsProducts ? prices.productsFeePence : 0,
  };
}
function cleaningQuote(
  pkg,
  baseMinutes,
  addons,
  bringsProducts,
  visits,
  prices = DEFAULT_CLEANING_BILLING_TERMS,
) {
  if (
    !validCleaningDuration(baseMinutes) ||
    !Number.isInteger(visits) ||
    (visits !== 1 && (visits < 6 || visits > 10))
  )
    throw new Error("Choose valid cleaning hours and visits.");
  const extras = parseCleaningExtras(addons, bringsProducts, prices);
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
function cleaningExtrasNotes(
  addons,
  bringsProducts,
  petsAtHome,
  prices = DEFAULT_CLEANING_BILLING_TERMS,
) {
  const extras = parseCleaningExtras(addons, bringsProducts, prices);
  return [
    `Pets at home: ${petsAtHome ? "Yes" : "No"}`,
    `Cleaning products: ${bringsProducts ? `cleaner brings products (\xA3${(prices.productsFeePence / 100).toFixed(2)} per visit)` : "supplied by customer"}`,
    ...(extras.addons.length
      ? [
          `Add-ons: ${extras.addons.map((item) => `${item.label} (up to 1 hour)`).join(", ")}`,
        ]
      : []),
  ].join("\n");
}

// lib/visitBillingPolicy.ts
var VISIT_CHANGE_NOTICE_HOURS = 24;
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
  refunds = DEFAULT_CLEANING_BILLING_TERMS.cancellationRefundPercent,
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
  if (
    !Number.isInteger(refundPercent) ||
    refundPercent < 0 ||
    refundPercent > 100
  )
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

// lib/visitMatchingPolicy.ts
function assignedPaymentMustCancel(
  scheduledAt,
  assigned,
  attempts,
  now = Date.now(),
  graceUntil = null,
) {
  const graceEnd = Math.min(
    new Date(graceUntil ?? "").getTime(),
    new Date(scheduledAt).getTime() - 3 * 36e5,
  );
  return (
    assigned &&
    attempts > 0 &&
    new Date(scheduledAt).getTime() - now <= 24 * 36e5 &&
    !(graceEnd > now)
  );
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
    );
    const terms = await bookingCleaningBillingTerms(admin, bookingId);
    return { booking, bill, charges, terms };
  }
  async function chargeGate(bookingId, operationId = null, kind = "charge") {
    return must(
      await admin.rpc("visit_charge_gate", {
        p_booking: bookingId,
        p_operation: operationId,
        p_kind: kind,
      }),
    );
  }
  async function refundBlockedPayment(bookingId) {
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
  async function chargeVisit(bookingId) {
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
      if (
        error instanceof Error &&
        error.message.startsWith("VISIT_CHARGE_BLOCKED:")
      )
        return { status: "blocked" };
      throw error;
    }
  }
  async function quoteExtras(bookingId, customerId, input) {
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
    const { booking, bill, charges, terms } = await load(
      bookingId,
      customerId ?? void 0,
    );
    if (unfilled && (await chargeGate(bookingId)).paused)
      return {
        status: "blocked",
        policy: calculateCancellationPolicy(
          booking.scheduled_at,
          paidTotal(charges) / 100,
          /* @__PURE__ */ new Date(),
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
          /* @__PURE__ */ new Date(),
          terms.cancellationRefundPercent,
        ),
      };
    const policy = calculateCancellationPolicy(
      booking.scheduled_at,
      paidTotal(charges) / 100,
      /* @__PURE__ */ new Date(),
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
    async function stopBlockedCharge(intent) {
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
          ? op.parameters.amountPence
          : (op.parameters.chargePence ?? 0);
      if (chargePence > 0) {
        let recorded = results.find((r) => r.type === "charge");
        let intent = recorded
          ? await stripe.paymentIntents.retrieve(recorded.id)
          : await findIntent(op, bill.stripe_customer_id);
        const blocked = await stopBlockedCharge(intent);
        if (blocked) return blocked;
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
      if (op.operation_type === "charge" || op.operation_type === "extras") {
        const current = await load(op.booking_id);
        if (current.bill.policy_refund_required)
          await refundBlockedPayment(op.booking_id);
        else if (op.operation_type === "charge" && current.bill.deadline_missed)
          await cancel(op.booking_id, null, false, void 0, true);
      }
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
    let unmatchedQuery = admin
      .from("bookings")
      .select("id,scheduled_at,optional_scheduled_at")
      .eq("status", "offered")
      .is("provider_id", null)
      .lte("offer_expires_at", /* @__PURE__ */ new Date().toISOString())
      .order("scheduled_at")
      .limit(limit);
    if (bookingIds) unmatchedQuery = unmatchedQuery.in("id", bookingIds);
    const unmatched = must(await unmatchedQuery);
    for (const row of unmatched) {
      const matchingDeadlineReached = [
        row.scheduled_at,
        ...(row.optional_scheduled_at ?? []),
      ].some((slot) => new Date(slot).getTime() <= Date.now() + 2 * 36e5);
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
    );
    for (const row of due) await chargeVisit(row.booking_id);
    check(
      await admin
        .from("visit_billing_runtime")
        .update({ last_scheduler_at: /* @__PURE__ */ new Date().toISOString() })
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

// lib/adminHosts.ts
var ADMIN_ORIGIN = "https://admin.opulencebliss.com";
var WEBSITE_ORIGIN = "https://www.opulencebliss.com";
function vercelOrigin(host) {
  if (!host || !/^[a-z0-9-]+\.vercel\.app$/i.test(host)) return null;
  return `https://${host.toLowerCase()}`;
}
function deploymentOrigins(env) {
  if (env.VERCEL_ENV === "preview") {
    const admin = vercelOrigin(env.VERCEL_BRANCH_URL);
    const website = vercelOrigin(env.VERCEL_URL);
    if (!admin || !website || admin === website)
      throw new Error("Separate Preview staff and website hosts are required.");
    return { admin, website };
  }
  return { admin: ADMIN_ORIGIN, website: WEBSITE_ORIGIN };
}
function within(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}
function isStaffPath(path) {
  return within(path, "/admin") || within(path, "/staff");
}
function notificationLink(path, website, env) {
  if (!/^\/(?!\/)[^\\\u0000-\u0020]*$/.test(path))
    throw new Error("Invalid notification link.");
  let origin = website;
  if (isStaffPath(path.split(/[?#]/)[0])) {
    origin =
      env.VISIT_PAYMENTS_MODE === "staging" && !env.VERCEL_ENV
        ? website
        : deploymentOrigins(env).admin;
  }
  const target = new URL(path, origin);
  if (target.protocol !== "https:")
    throw new Error("A secure notification address is required.");
  return target.toString();
}

// lib/bookingSms.ts
import { Buffer } from "node:buffer";
function bookingSmsConfig(env) {
  if (env.BOOKING_SMS_ENABLED !== "true") return null;
  const budget = Number(env.TWILIO_MONTHLY_BUDGET_GBP),
    cost = Number(env.TWILIO_MAX_COST_PER_MESSAGE_GBP);
  if (
    !/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID ?? "") ||
    !env.TWILIO_AUTH_TOKEN ||
    !/^MG[0-9a-f]{32}$/i.test(env.TWILIO_MESSAGING_SERVICE_SID ?? "") ||
    !Number.isFinite(budget) ||
    budget <= 0 ||
    budget > 1e4 ||
    !Number.isFinite(cost) ||
    cost <= 0 ||
    cost > budget
  )
    return null;
  return {
    account: env.TWILIO_ACCOUNT_SID,
    token: env.TWILIO_AUTH_TOKEN,
    service: env.TWILIO_MESSAGING_SERVICE_SID,
    monthlyBudgetPence: Math.floor(budget * 100),
    costCapPence: Math.ceil(cost * 100),
  };
}
function bookingSmsText(kind, bookingId, scheduledAt) {
  const lead = {
    received: "Booking received",
    confirmed: "Booking confirmed",
    reminder_24h: "Your booking is in 24 hours",
    reminder_90m: "Your booking is in 1 hour 30 minutes",
    unmatched_cancelled: "No cleaner found; visit cancelled",
  }[kind];
  if (!lead) throw new Error("Unsupported SMS event");
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(scheduledAt));
  return `Opulence Bliss: ${lead}. ${time} (London time). Ref ${bookingId.slice(0, 8)}. See My bookings for details.`;
}
async function submitBookingSms(config, to, body, fetcher = fetch) {
  if (
    !/^\+44\d{10}$/.test(to) ||
    body.length > 160 ||
    !/^[\x20-\x7e]+$/.test(body)
  )
    throw new Error("Invalid SMS destination or message.");
  const response = await fetcher(
    `https://api.twilio.com/2010-04-01/Accounts/${config.account}/Messages.json`,
    {
      method: "POST",
      signal: AbortSignal.timeout(8e3),
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(config.account + ":" + config.token).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        MessagingServiceSid: config.service,
        Body: body,
        ValidityPeriod: "300",
      }).toString(),
    },
  );
  if (!response.ok)
    throw new Error(
      `SMS provider returned ${response.status}; manual review required.`,
    );
  const reply = await response.json();
  if (
    !reply ||
    typeof reply !== "object" ||
    !("sid" in reply) ||
    typeof reply.sid !== "string" ||
    !/^SM[0-9a-f]{32}$/i.test(reply.sid)
  )
    throw new Error(
      "SMS provider did not return a message reference; manual review required.",
    );
  return reply.sid;
}

// lib/visitMatchingNotices.ts
async function deliverVisitMatchingNotices(admin, env, fetcher = fetch) {
  const key = env.RESEND_API_KEY;
  const sender = env.BOOKING_EMAIL_FROM ?? env.EMAIL_FROM;
  const origin = env.NEXT_PUBLIC_SITE_URL;
  const stagingRecipients =
    env.VISIT_PAYMENTS_MODE === "staging"
      ? new Set(
          (env.STAGING_EMAIL_RECIPIENTS ?? "")
            .split(",")
            .map((recipient) => recipient.trim().toLowerCase())
            .filter((recipient) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient),
            ),
        )
      : null;
  const emailEnabled = Boolean(
    key &&
    sender &&
    origin?.startsWith("https://") &&
    (stagingRecipients === null || stagingRecipients.size > 0),
  );
  const sms = bookingSmsConfig(env);
  const { data, error } = await admin.rpc("claim_visit_matching_notices", {
    p_email_enabled: emailEnabled,
    p_sms_enabled: Boolean(sms),
    p_budget_pence: sms?.monthlyBudgetPence ?? 0,
    p_cost_pence: sms?.costCapPence ?? 0,
  });
  if (error) throw new Error("Matching notices could not be claimed.");
  let submitted = 0;
  let failed = 0;
  let excluded = 0;
  for (const notice of data ?? []) {
    let reference = null;
    let failure = null;
    try {
      const { data: allowed, error: checkError } = await admin.rpc(
        "visit_matching_notice_allowed",
        { p_id: notice.id, p_token: notice.claim_token },
      );
      if (checkError)
        throw new Error("Matching notice state could not be checked.");
      if (allowed !== true) {
        failure = "Notice no longer applies.";
        continue;
      }
      if (!notice.recipient)
        throw new Error("Notification destination is missing.");
      if (notice.channel === "email") {
        if (!emailEnabled || !key || !sender || !origin)
          throw new Error("Staging email is not configured.");
        if (
          stagingRecipients &&
          !stagingRecipients.has(notice.recipient.trim().toLowerCase())
        ) {
          failure = "Staging recipient is not approved for test delivery.";
          excluded++;
          continue;
        }
        if (!notice.href.startsWith("/") || notice.href.startsWith("//"))
          throw new Error("Invalid booking link.");
        const response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(8e3),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `visit-matching/${notice.id}`,
          },
          body: JSON.stringify({
            from: sender,
            to: [notice.recipient],
            subject: notice.title,
            text: `${notice.body}

View your booking: ${notificationLink(notice.href, origin, env)}`,
          }),
        });
        if (!response.ok)
          throw new Error(`Email provider returned ${response.status}.`);
        const result = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("id" in result) ||
          typeof result.id !== "string"
        )
          throw new Error("Email acceptance was not confirmed.");
        reference = result.id;
      } else {
        if (!sms) throw new Error("SMS remains switched off.");
        reference = await submitBookingSms(
          sms,
          notice.recipient,
          bookingSmsText(notice.kind, notice.booking_id, notice.scheduled_at),
          fetcher,
        );
      }
      submitted++;
    } catch {
      failure = "Notification submission failed or is uncertain.";
      failed++;
    } finally {
      const { error: finishError } = await admin.rpc(
        "finish_visit_matching_notice",
        {
          p_id: notice.id,
          p_token: notice.claim_token,
          p_reference: reference,
          p_error: failure,
        },
      );
      if (finishError) failed++;
    }
  }
  return {
    emailConfigured: emailEnabled,
    smsEnabled: Boolean(sms),
    submitted,
    failed,
    excluded,
  };
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
    notices: deliverVisitMatchingNotices,
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
      const notices = await deps.notices(
        admin,
        Object.fromEntries(
          [
            "RESEND_API_KEY",
            "VISIT_PAYMENTS_MODE",
            "STAGING_EMAIL_RECIPIENTS",
            "BOOKING_EMAIL_FROM",
            "EMAIL_FROM",
            "NEXT_PUBLIC_SITE_URL",
            "BOOKING_SMS_ENABLED",
            "TWILIO_ACCOUNT_SID",
            "TWILIO_AUTH_TOKEN",
            "TWILIO_MESSAGING_SERVICE_SID",
            "TWILIO_MONTHLY_BUDGET_GBP",
            "TWILIO_MAX_COST_PER_MESSAGE_GBP",
          ].map((name) => [name, deps.env(name)]),
        ),
      );
      return Response.json({
        ok: true,
        mode,
        source:
          "b0aeab73242c0ad16dde30de74f648f55d468b42f42637b31f8ba8f8c26b1d28",
        result,
        notices,
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
