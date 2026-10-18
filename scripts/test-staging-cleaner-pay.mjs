import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";

// Run only against explicitly fictional staging fixtures. Never load Production.
const config = JSON.parse(
  readFileSync(".local-secrets/staging-api.json", "utf8"),
);
if (
  config.NEXT_PUBLIC_SUPABASE_URL !==
    "https://comwdjprdedmsnxtvuuk.supabase.co" ||
  !config.STRIPE_SECRET_KEY?.startsWith("sk_test_")
)
  throw new Error("Staging isolation required");
Object.assign(process.env, config, {
  RESEND_API_KEY: "",
  BOOKING_SMS_ENABLED: "false",
});
const statePath = ".local-secrets/client-decisions-fixtures.json";
const state = JSON.parse(readFileSync(statePath, "utf8"));
const admin = createClient(
  config.NEXT_PUBLIC_SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const stripe = new Stripe(config.STRIPE_SECRET_KEY);
await build({
  stdin: {
    contents:
      'export {finalizePerVisitCheckout} from "./lib/finalizePerVisitCheckout"; export {createVisitBilling} from "./lib/visitBillingServer"; export {settleCompletedVisitPayout} from "./lib/prepaidVisitPayout"; export {finalizeTipCheckout} from "./lib/finalizeTipCheckout"; export {getOrCreateBillingCustomer} from "./lib/accountBilling"; export {currentCleaningBillingTerms} from "./lib/cleaningBillingSettings"; export {cleaningSeriesQuote} from "./lib/cleaningExtras"; export {visitLineItems} from "./lib/visitLineItems";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "artifacts/client-payment-runtime.mjs",
  packages: "external",
  plugins: [
    {
      name: "server-marker",
      setup(builder) {
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "marker",
          namespace: "empty",
        }));
        builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
          contents: "",
        }));
      },
    },
  ],
});
const runtime = await import("../artifacts/client-payment-runtime.mjs");
const checks = state.paymentCheckResults ?? [];
state.paymentCheckResults = checks;
state.paymentChecks ??= {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const pass = (condition, label) => {
  if (!condition) throw new Error(label);
  checks.push({ check: label, passed: true });
  console.log("PASS " + label);
};
async function data(query, label) {
  const result = await query;
  if (result.error) throw new Error(label + ": " + result.error.message);
  return result.data;
}
const customer = state.users.customer;

async function card() {
  if (state.paymentChecks.customer) return;
  const id = await runtime.getOrCreateBillingCustomer(stripe, customer);
  const method = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });
  await stripe.paymentMethods.attach(method.id, { customer: id });
  await stripe.customers.update(id, {
    invoice_settings: { default_payment_method: method.id },
  });
  state.paymentChecks.customer = id;
  state.paymentChecks.method = method.id;
  save();
}

async function fixture(name, regular = false, addons = ["oven"]) {
  if (state.paymentChecks[name]) return state.paymentChecks[name];
  const pkg = await data(
    admin
      .from("packages")
      .select("id,name,price,duration_minutes,service_type")
      .eq("name", regular ? "Essential Clean" : "One-Time Essential Clean")
      .eq("active", true)
      .single(),
    "Load package",
  );
  const terms = await runtime.currentCleaningBillingTerms(admin);
  const plan = runtime.cleaningSeriesQuote(
    pkg,
    120,
    addons,
    true,
    regular ? 6 : 1,
    [],
    terms,
  );
  const now = new Date();
  now.setUTCDate(
    now.getUTCDate() + (name === "partialExtras" ? 18 : regular ? 20 : 17),
  );
  now.setUTCHours(9, 0, 0, 0);
  if (name === "unmatchedOneOff") {
    now.setUTCDate(new Date().getUTCDate() - 1);
    now.setUTCMonth(new Date().getUTCMonth());
    now.setUTCHours(10, 0, 0, 0);
  }
  const slots = Array.from({ length: regular ? 6 : 1 }, (_, i) =>
    new Date(now.getTime() + i * 7 * 86400000).toISOString(),
  );
  const sessionId = "cs_test_decisions_" + randomUUID().replaceAll("-", "");
  const metadata = {
    kind: "booking",
    billing_model: "per_visit",
    customer_id: customer.id,
    package_id: pkg.id,
    package: pkg.name,
    booking_frequency: regular ? "weekly" : "one_time",
    regular_visit_count: String(slots.length),
    base_duration_minutes: "120",
    service_address: "FICTIONAL STAGING PAY TEST, EC1V 2NX",
    postcode: "ZZ99 1ZZ",
    upfront_regular: regular ? "1" : "0",
  };
  const scopes = plan.quotes.map((quote) => ({
    baseMinutes: 120,
    basePricePence: quote.basePence,
    durationMinutes: quote.durationMinutes,
    addons: quote.addons.map((x) => x.id),
    bringsProducts: true,
    petsAtHome: false,
    grossPence: quote.totalPence,
    netPence: quote.totalPence,
    discountPence: 0,
    lineItems: runtime.visitLineItems(quote),
    notes: "FICTIONAL STAGING PAYMENT TEST ONLY",
    cardConsentAt: new Date().toISOString(),
    cardConsentVersion: "visit-billing-v1",
    billingSettings: terms,
    chargeTiming: regular ? "acceptance" : "checkout_then_48h",
  }));
  await data(
    admin.from("booking_checkout_time_choices").insert({
      checkout_session_id: sessionId,
      customer_id: customer.id,
      preferred_scheduled_at: slots[0],
      optional_scheduled_at: [],
      regular_scheduled_at: regular ? slots : [],
      household_notes: "FICTIONAL TEST ONLY",
      cleaning_extras: scopes,
      booking_preferences: {
        howHeard: "Instagram",
        confirmationChannel: "email",
        roomsToClean: "Kitchen and living room",
        accessInstructions: "Fictional concierge",
      },
    }),
    "Stage fictional visit scope",
  );
  let intent;
  if (regular)
    intent = await stripe.setupIntents.create({
      customer: state.paymentChecks.customer,
      payment_method: state.paymentChecks.method,
      payment_method_types: ["card"],
      usage: "off_session",
      confirm: true,
      metadata,
    });
  else
    intent = await stripe.paymentIntents.create({
      customer: state.paymentChecks.customer,
      payment_method: state.paymentChecks.method,
      amount: scopes[0].netPence,
      currency: "gbp",
      payment_method_types: ["card"],
      capture_method: "automatic",
      setup_future_usage: "off_session",
      confirm: true,
      metadata,
    });
  const session = {
    id: sessionId,
    mode: regular ? "setup" : "payment",
    status: "complete",
    client_reference_id: customer.id,
    customer: state.paymentChecks.customer,
    customer_details: { email: customer.email },
    created: Math.floor(Date.now() / 1000),
    payment_intent: regular ? null : intent.id,
    setup_intent: regular ? intent.id : null,
    payment_status: regular ? "no_payment_required" : "paid",
    metadata,
  };
  const id = await runtime.finalizePerVisitCheckout(session, intent);
  const booking = await data(
    admin.from("bookings").select("id,regular_series_id").eq("id", id).single(),
    "Find saved booking",
  );
  const ids = regular
    ? (
        await data(
          admin
            .from("bookings")
            .select("id")
            .eq("regular_series_id", booking.regular_series_id)
            .order("regular_visit_number"),
          "Load regular visits",
        )
      ).map((x) => x.id)
    : [id];
  const fixture = {
    id,
    ids,
    intent: intent.id,
    session,
    amountPence: scopes[0].netPence,
    scheduledAt: slots[0],
    termsVersion: terms.version,
  };
  state.paymentChecks[name] = fixture;
  save();
  return fixture;
}

async function accept(bookingId) {
  await data(
    admin
      .from("booking_offers")
      .upsert(
        { booking_id: bookingId, provider_id: state.provider, status: "open" },
        { onConflict: "booking_id,provider_id" },
      ),
    "Offer only to fictional worker",
  );
  const worker = createClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.VISIT_PAYMENTS_GATEWAY_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const signed = await worker.auth.signInWithPassword({
    email: state.users.worker.email,
    password: state.users.worker.password,
  });
  if (signed.error) throw new Error("Fictional worker sign-in failed");
  const booking = await data(
    admin
      .from("bookings")
      .select("status,scheduled_at")
      .eq("id", bookingId)
      .single(),
    "Read worker booking",
  );
  if (booking.status === "offered")
    await data(
      worker.rpc("provider_accept_booking_time", {
        p_booking_id: bookingId,
        p_selected_slot: booking.scheduled_at,
      }),
      "Cleaner acceptance",
    );
  return worker;
}

async function run() {
  pass(
    (await stripe.accounts.retrieve()).id === "acct_1UKQ4A2NzINBHbzj",
    "Stripe sandbox account and staging database isolation confirmed",
  );
  await card();
  const one = await fixture("oneOff");
  const pi = await stripe.paymentIntents.retrieve(one.intent);
  pass(
    pi.status === "succeeded" &&
      pi.amount_received === 7098 &&
      pi.capture_method === "automatic" &&
      !pi.transfer_data,
    "One-off charged £70.98 immediately without a destination charge or card hold",
  );
  let payment = await data(
    admin
      .from("payments")
      .select("split_breakdown,status")
      .eq("booking_id", one.id)
      .or("kind.is.null,kind.neq.tip")
      .single(),
    "Read one-off allocation",
  );
  pass(
    payment.status === "succeeded" &&
      Number(payment.split_breakdown.provider) === 30 &&
      Number(payment.split_breakdown.platform_margin) === 40.98 &&
      Number(payment.split_breakdown.business_extras) === 25 &&
      payment.split_breakdown.pay_rate_pending === false,
    "Two booked cleaning hours allocate £30 cleaner pay and £40.98 business funds, including £25 extras",
  );
  const bill = await data(
    admin
      .from("booking_visit_billing")
      .select("rate_confirmed")
      .eq("booking_id", one.id)
      .single(),
    "Read pay release",
  );
  pass(
    bill.rate_confirmed === true,
    "The held payout calculation is released at the agreed hourly rate",
  );
  const terms = await data(
    admin
      .from("booking_cleaning_billing_terms")
      .select("terms")
      .eq("booking_id", one.id)
      .single(),
    "Read booking snapshot",
  );
  const changedTerms = {
    ...terms.terms,
    cleanerHourlyPence: 1600,
    productsFeePence: 600,
    tipMinimumPence: 400,
    addonPrices: { ...terms.terms.addonPrices, oven: 2500 },
    cancellationRefundPercent: {
      full: 100,
      three_quarter: 80,
      half: 60,
      none: 0,
    },
  };
  if (!state.paymentChecks.settingsTested) {
    await data(
      admin
        .from("cleaning_billing_settings")
        .insert({ terms: changedTerms, created_by: state.users.staff.id }),
      "Create changed staging settings",
    );
    try {
      const existingQuote = await runtime
        .createVisitBilling(admin, stripe)
        .quoteExtras(one.id, customer.id, { addons: [], bringsProducts: true });
      pass(
        existingQuote.refundPence === 2000 &&
          existingQuote.amountPence === 5098,
        "Existing booking add-on edits retain its old oven and products prices after settings change",
      );
      const next = await fixture("changedSettings", false, []);
      const nextPayment = await data(
        admin
          .from("payments")
          .select("split_breakdown")
          .eq("booking_id", next.id)
          .single(),
        "Read new settings payment",
      );
      pass(
        Number(nextPayment.split_breakdown.provider) === 32 &&
          next.amountPence === 5198,
        "A new booking uses the edited £16 hourly pay and £6 products fee",
      );
      state.paymentChecks.settingsTested = true;
      save();
    } finally {
      await data(
        admin
          .from("cleaning_billing_settings")
          .insert({ terms: terms.terms, created_by: state.users.staff.id }),
        "Restore decided staging defaults as a new version",
      );
    }
  }
  const regular = await fixture("regular", true, ["fridge"]);
  let charges = await data(
    admin
      .from("booking_visit_charges")
      .select("id")
      .in("booking_id", regular.ids),
    "Read unassigned series charges",
  );
  pass(
    regular.ids.length === 6 &&
      !charges.some((c) => c.stripe_payment_intent?.startsWith("seti_")),
    "Regular saved-card setup is never recorded as a payment",
  );
  if (charges.length === 0) {
    pass(
      regular.ids.length === 6,
      "All six regular visits are saved with no checkout charge, including visit one",
    );
    const unassigned = await runtime
      .createVisitBilling(admin, stripe)
      .chargeVisit(regular.id);
    pass(
      unassigned.status === "blocked",
      "A regular visit cannot charge without an assigned cleaner",
    );
  }
  await accept(regular.id);
  const charged = await runtime
    .createVisitBilling(admin, stripe)
    .chargeVisit(regular.id);
  pass(
    ["succeeded", "paid"].includes(charged.status),
    "Cleaner acceptance triggers the regular visit payment even more than 48h ahead",
  );
  charges = await data(
    admin
      .from("booking_visit_charges")
      .select("booking_id,amount_pence,stripe_payment_intent")
      .in("booking_id", regular.ids),
    "Read accepted visit charge",
  );
  pass(
    charges.length === 1 &&
      charges[0].booking_id === regular.id &&
      charges[0].amount_pence === regular.amountPence,
    "Only the accepted regular visit is charged; the other five stay uncharged",
  );
  await runtime.createVisitBilling(admin, stripe).chargeVisit(regular.id);
  pass(
    (
      await data(
        admin
          .from("booking_visit_charges")
          .select("id")
          .in("booking_id", regular.ids),
        "Verify retry count",
      )
    ).length === 1,
    "Repeating regular charge processing cannot double-charge the accepted visit",
  );
  const accounts = await stripe.accounts.list({ limit: 50 });
  const destination = accounts.data.find(
    (a) =>
      a.capabilities?.transfers === "active" && a.metadata?.synthetic_fixture,
  );
  if (!destination)
    throw new Error(
      "An active explicitly synthetic Connect destination is required",
    );
  await data(
    admin
      .from("providers")
      .update({ stripe_account_id: destination.id })
      .eq("id", state.provider),
    "Connect only the new fictional fixture worker",
  );
  const worker = await accept(one.id);
  if (!state.paymentChecks.completed) {
    await data(
      worker.rpc("transition_booking", {
        p_booking_id: one.id,
        p_to_status: "in_progress",
        p_reason: "Fictional staging payout test",
        p_meta: {},
      }),
      "Start fictional test visit",
    );
    await data(
      admin.rpc("system_transition_booking", {
        p_booking_id: one.id,
        p_to_status: "completed",
        p_reason: "Fictional staging payout test",
        p_meta: {},
      }),
      "Complete fictional test visit",
    );
    state.paymentChecks.completed = true;
    save();
  }
  const payout = await runtime.settleCompletedVisitPayout(one.id);
  pass(
    payout.payoutSettled && payout.earned === 30,
    "Completed sample visit pays the assigned cleaner £30",
  );
  await runtime.settleCompletedVisitPayout(one.id);
  const transfers = (
    await stripe.transfers.list({ destination: destination.id, limit: 100 })
  ).data.filter(
    (t) =>
      t.metadata.booking_id === one.id && t.metadata.kind === "one_off_visit",
  );
  pass(
    transfers.length === 1 &&
      transfers[0].amount === 3000 &&
      transfers[0].destination === destination.id,
    "Exactly one £30 transfer reaches the assigned cleaner's test account after a payout retry",
  );
  if (!state.paymentChecks.tip) {
    const tip = await stripe.paymentIntents.create({
      amount: 300,
      currency: "gbp",
      customer: state.paymentChecks.customer,
      payment_method: state.paymentChecks.method,
      payment_method_types: ["card"],
      confirm: true,
      off_session: true,
      metadata: { kind: "tip", booking_id: one.id, tip_minimum_pence: "300" },
    });
    state.paymentChecks.tip = tip.id;
    save();
  }
  const tip = await stripe.paymentIntents.retrieve(state.paymentChecks.tip);
  const tipSession = {
    id: "cs_test_tip_decisions_" + state.run,
    mode: "payment",
    payment_status: "paid",
    client_reference_id: customer.id,
  };
  await runtime.finalizeTipCheckout(tipSession, tip);
  await runtime.finalizeTipCheckout(tipSession, tip);
  const tips = (
    await stripe.transfers.list({ destination: destination.id, limit: 100 })
  ).data.filter(
    (t) => t.metadata.booking_id === one.id && t.metadata.kind === "tip",
  );
  pass(
    tips.length === 1 && tips[0].amount === 300,
    "A £3 tip transfers in full to the same assigned cleaner, exactly once",
  );

  const fresh = await fixture("regularUnassigned", true, []);
  const freshCharges = await data(
    admin
      .from("booking_visit_charges")
      .select("id")
      .in("booking_id", fresh.ids),
    "Fresh unassigned series",
  );
  pass(
    freshCharges.length === 0 && fresh.ids.length === 6,
    "Fresh regular checkout records six visits and zero charges after the setup fix",
  );
  pass(
    (await runtime.createVisitBilling(admin, stripe).chargeVisit(fresh.id))
      .status === "blocked",
    "Recovery also leaves a fresh unassigned regular visit uncharged",
  );
  if (!state.paymentChecks.partialTested) {
    const partial = await fixture("partialExtras");
    const engine = runtime.createVisitBilling(admin, stripe);
    const quote = await engine.quoteExtras(partial.id, customer.id, {
      addons: [],
      bringsProducts: true,
    });
    const result = await engine.changeExtras(partial.id, customer.id, {
      addons: [],
      bringsProducts: true,
      revision: quote.revision,
      chargePence: quote.chargePence,
      refundPence: quote.refundPence,
    });
    pass(
      result.status === "succeeded" && quote.refundPence === 2000,
      "Removing a paid oven add-on refunds its £20 business fee in full",
    );
    const worker = await accept(partial.id);
    await data(
      worker.rpc("transition_booking", {
        p_booking_id: partial.id,
        p_to_status: "in_progress",
        p_reason: "Fictional staging test",
        p_meta: {},
      }),
      "Start partial-refund test visit",
    );
    await data(
      worker.rpc("transition_booking", {
        p_booking_id: partial.id,
        p_to_status: "completed",
        p_reason: "Fictional staging test",
        p_meta: {},
      }),
      "Complete partial-refund test visit",
    );
    const paid = await runtime.settleCompletedVisitPayout(partial.id);
    pass(
      paid.payoutSettled && paid.earned === 30,
      "An add-on refund does not block the cleaner's unchanged £30 base pay",
    );
    state.paymentChecks.partialTested = true;
    save();
  }
  if (!state.paymentChecks.customRefundTested) {
    const changed = state.paymentChecks.changedSettings;
    const when = new Date(Date.now() + 86400000);
    when.setUTCHours(10, 0, 0, 0);
    if (when.getTime() < Date.now() + 24 * 3600000)
      when.setUTCDate(when.getUTCDate() + 1);
    await data(
      admin.rpc("system_reschedule_booking", {
        p_booking_id: changed.id,
        p_new_slot: when.toISOString(),
        p_reason: "Fictional staging refund-band test",
        p_meta: {},
      }),
      "Move only the fictional custom-policy fixture into its refund band",
    );
    const cancelled = await runtime
      .createVisitBilling(admin, stripe)
      .cancel(changed.id, customer.id);
    const intent = await stripe.paymentIntents.retrieve(changed.intent, {
      expand: ["latest_charge"],
    });
    pass(
      cancelled.status === "succeeded" &&
        cancelled.policy.refundPercent === 80 &&
        intent.latest_charge.amount_refunded ===
          Math.round(changed.amountPence * 0.8),
      "A saved custom 80% cancellation band is enforced by Stripe and the database after settings are restored",
    );
    state.paymentChecks.customRefundTested = true;
    save();
  }

  const unmatched = await fixture("unmatchedOneOff");
  await runtime.createVisitBilling(admin, stripe).tick(5, [unmatched.id]);
  const unmatchedBooking = await data(
    admin.from("bookings").select("status").eq("id", unmatched.id).single(),
    "Read unmatched deadline result",
  );
  const unmatchedIntent = await stripe.paymentIntents.retrieve(
    unmatched.intent,
    { expand: ["latest_charge"] },
  );
  pass(
    unmatchedBooking.status === "cancelled" &&
      unmatchedIntent.latest_charge.amount_refunded === unmatched.amountPence,
    "An unmatched one-off at its deadline is automatically cancelled and refunded in full",
  );
  await runtime.createVisitBilling(admin, stripe).tick(5, [unmatched.id]);
  const unmatchedRefunds = await stripe.refunds.list({
    payment_intent: unmatched.intent,
  });
  pass(
    unmatchedRefunds.data.length === 1,
    "Repeating unmatched recovery does not issue another refund",
  );
  const report = {
    environment: "staging",
    stripeAccount: "acct_1UKQ4A2NzINBHbzj",
    mode: "test",
    oneOffBooking: one.id,
    regularFirstVisit: regular.id,
    amountChargedPence: 7098,
    cleanerTransferPence: 3000,
    businessAllocationPence: 4098,
    businessExtrasPence: 2500,
    tipTransferPence: 300,
    checks,
  };
  writeFileSync(
    "artifacts/client-decisions-payment-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "Staging Stripe API payout checks passed. No Production access was used.",
  );
}

try {
  await run();
} catch (error) {
  save();
  console.error(
    "FAILED: " +
      (error instanceof Error ? error.message : "Unknown staging failure"),
  );
  process.exitCode = 1;
}
