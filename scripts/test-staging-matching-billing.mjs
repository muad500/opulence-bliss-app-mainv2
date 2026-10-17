import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID, webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Local integration runner only: no request is sent to a Vercel deployment.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (!args.includes("--run-real-staging")) {
  console.log(
    "Staging-only integration suite. Use --run-real-staging; optional --case NAME. The expired-window case also needs --advance-owned-clock and its isolated SQL step.",
  );
  process.exit(0);
}
const credentialPath = resolve(root, ".local-secrets/staging-api.json");
const secrets = JSON.parse(readFileSync(credentialPath, "utf8"));
const database = "comwdjprdedmsnxtvuuk";
const expectedAccount = "acct_1UKQ4A2NzINBHbzj";
const databaseUrl = `https://${database}.supabase.co`;
assert.equal(secrets.NEXT_PUBLIC_SUPABASE_URL, databaseUrl);
const claims = JSON.parse(
  Buffer.from(
    secrets.SUPABASE_SERVICE_ROLE_KEY.split(".")[1],
    "base64url",
  ).toString(),
);
assert.equal(claims.ref, database);
assert.equal(claims.role, "service_role");
const safeFetch = (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : (input.url ?? String(input)),
  );
  assert.equal(
    url.origin,
    databaseUrl,
    "Refusing a request outside the staging database.",
  );
  return fetch(input, init);
};
const admin = createClient(databaseUrl, secrets.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: safeFetch },
});
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function sanitized(message) {
  let text = String(message);
  for (const value of Object.values(secrets)) {
    if (typeof value === "string" && value.length > 20)
      text = text.replaceAll(value, "[redacted]");
  }
  return text
    .replace(
      /(?:sk_(?:test|live)_|pk_(?:test|live)_|whsec_)[A-Za-z0-9_]+/g,
      "[redacted]",
    )
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, "[redacted]");
}
const require = createRequire(import.meta.url);
const cache = new Map();
const boundaries = new Map();
function load(file) {
  const path = resolve(root, file);
  if (cache.has(path)) return cache.get(path).exports;
  const moduleRecord = { exports: {} };
  cache.set(path, moduleRecord);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (id) => {
    if (boundaries.has(id)) return boundaries.get(id);
    if (id === "server-only") return {};
    // Keep one Stripe error-class identity across the ESM runner and the
    // transpiled CommonJS app modules, as the normal app bundle does.
    if (id === "stripe") return Stripe;
    if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
    if (id.startsWith(".")) {
      let next = resolve(dirname(path), id);
      if (!existsSync(next)) next += ".ts";
      return load(next);
    }
    return require(id);
  };
  vm.runInNewContext(
    code,
    {
      module: moduleRecord,
      exports: moduleRecord.exports,
      require: localRequire,
      process,
      Date,
      Buffer,
      crypto: webcrypto,
      console: { log() {}, warn() {}, error() {} },
      URL,
      Request,
      Response,
      Headers,
      setTimeout,
      clearTimeout,
    },
    { filename: path },
  );
  return moduleRecord.exports;
}

async function runSuite(admin, stripe, packages) {
  // These are the real application's billing engine and RPCs, with real
  // sandbox Stripe effects. Hosted Checkout remains a separate manual check.
  const { createVisitBilling } = load("lib/visitBillingServer.ts");
  const { cleaningSeriesQuote } = load("lib/cleaningExtras.ts");
  const { regularVisitSlots } = load("lib/regularBooking.ts");
  const { visitLineItems } = load("lib/visitLineItems.ts");
  const { appointmentFitsWindow } = load("lib/appointmentWindow.ts");
  const engine = createVisitBilling(admin, stripe);
  const runId = randomUUID();
  const reportPath = resolve(
    root,
    `artifacts/staging-matching-tests-${runId}.json`,
  );
  const report = {
    runId,
    startedAt: new Date().toISOString(),
    accountId: expectedAccount,
    mode: "test",
    database,
    sourceTree: "assignment-aware-working-tree",
    testedThrough:
      "Local staging-source billing engine + real Stripe test API + staging database RPCs",
    hostedCheckoutTested: false,
    permanentSchedulerTested: false,
    productionChanged: false,
    cases: [],
    fixtures: [],
  };
  const save = () =>
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  save();
  const fixtureIds = new Set();
  async function own(id) {
    assert.ok(
      fixtureIds.has(id),
      "Refusing to change a booking outside this run.",
    );
    return id;
  }
  async function caseOf(name, fn) {
    if (
      name === "expired_card_update_window_cancels_without_another_charge" &&
      !args.includes("--advance-owned-clock")
    )
      return;
    if (args.includes("--case") && args[args.indexOf("--case") + 1] !== name)
      return;
    console.log(JSON.stringify({ phase: "case_started", case: name }));
    try {
      const details = await fn();
      const row = { case: name, passed: true, ...details };
      report.cases.push(row);
      console.log(JSON.stringify(row));
    } catch (error) {
      const row = {
        case: name,
        passed: false,
        error: sanitized(error.message),
        stripeCode:
          error instanceof Stripe.errors.StripeError
            ? (error.code ?? error.type)
            : undefined,
      };
      report.cases.push(row);
      console.log(JSON.stringify(row));
      process.exitCode = 1;
    }
    save();
  }
  function futureSlot(duration = 120, minHours = 25, maxHours = 47) {
    const now = Date.now();
    const step = 30 * 60_000;
    for (
      let at = Math.ceil((now + minHours * 3_600_000) / step) * step;
      at <= now + maxHours * 3_600_000;
      at += step
    ) {
      const date = new Date(at);
      if (appointmentFitsWindow(date, duration)) return date;
    }
    throw new Error(
      "No valid daytime fixture slot in the requested real-clock window.",
    );
  }
  async function cardFor(customer, failed = false) {
    const method = await stripe.paymentMethods.create({
      type: "card",
      card: { token: failed ? "tok_chargeCustomerFail" : "tok_visa" },
    });
    assert.equal(method.livemode, false);
    await stripe.paymentMethods.attach(method.id, { customer });
    await stripe.customers.update(customer, {
      invoice_settings: { default_payment_method: method.id },
    });
    return method;
  }
  async function fixture(
    name,
    {
      regular = false,
      addons = [],
      products = false,
      scheduledAt,
      clock = false,
    } = {},
  ) {
    const pkg = packages.find(
      (p) =>
        p.name === (regular ? "Essential Clean" : "One-Time Essential Clean"),
    );
    assert.ok(pkg, "The staging cleaning package is missing.");
    const quote = cleaningSeriesQuote(
      pkg,
      120,
      addons,
      products,
      regular ? 6 : 1,
    );
    const first = scheduledAt ?? futureSlot(quote.maxDurationMinutes, 169, 190);
    if (!clock)
      assert.ok(appointmentFitsWindow(first, quote.maxDurationMinutes));
    const { londonDate, londonParts } = load("lib/appointmentWindow.ts");
    const anchor = londonParts(first);
    const clockSlots = () =>
      Array.from({ length: 6 }, (_, index) => {
        const day = new Date(
          Date.UTC(anchor.year, anchor.month - 1, anchor.day + 7 * index),
        );
        return londonDate(
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          anchor.hour,
          anchor.minute,
        ).toISOString();
      });
    const slots =
      regular && clock
        ? clockSlots()
        : regular
          ? regularVisitSlots(
              first.toISOString(),
              "weekly",
              quote.maxDurationMinutes,
              clock ? first.getTime() - 86400000 : Date.now(),
              6,
            )
          : [first.toISOString()];
    const label = `${runId}-${name}`;
    const email = `billing-api-${randomUUID()}@example.invalid`;
    const response = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name: "Disposable staging payment test",
        staging_api_run: runId,
      },
    });
    checked(response);
    const user = response.data.user;
    assert.ok(user?.id);
    checked(
      await admin.from("profiles").insert({
        id: user.id,
        email,
        role: "customer",
        full_name: "Disposable staging payment test",
      }),
    );
    const customer = await stripe.customers.create(
      { email, metadata: { staging_audit: label, opulence_user_id: user.id } },
      { idempotencyKey: `${label}:customer` },
    );
    assert.equal(customer.livemode, false);
    checked(
      await admin
        .from("account_billing_customers")
        .insert({ user_id: user.id, stripe_customer_id: customer.id }),
    );
    const card = await cardFor(customer.id);
    const plan = quote.quotes.map((q) => ({
      baseMinutes: 120,
      basePricePence: q.basePence,
      addons: q.addons.map((a) => a.id),
      bringsProducts: products,
      petsAtHome: true,
      durationMinutes: q.durationMinutes,
      grossPence: q.totalPence,
      netPence: q.totalPence,
      discountPence: 0,
      lineItems: visitLineItems(q),
      billingModel: "per_visit",
      payRatePending: true,
      notes: `Disposable staging API test ${label}`,
      cardConsentAt: new Date().toISOString(),
      cardConsentVersion: "visit-billing-v1",
    }));
    const saved = {
      name,
      userId: user.id,
      stripeCustomer: customer.id,
      bookingIds: [],
      firstIntent: null,
    };
    report.fixtures.push(saved);
    save();
    const intent = await stripe.paymentIntents.create(
      {
        amount: plan[0].netPence,
        currency: "gbp",
        customer: customer.id,
        payment_method: card.id,
        payment_method_types: ["card"],
        capture_method: "automatic",
        confirm: true,
        setup_future_usage: "off_session",
        metadata: { kind: "staging_billing_audit", staging_audit: label },
      },
      { idempotencyKey: `${label}:checkout-charge` },
    );
    assert.equal(intent.livemode, false);
    assert.equal(intent.status, "succeeded");
    assert.equal(intent.amount_received, plan[0].netPence);
    assert.equal(intent.amount_capturable, 0);
    assert.equal(Boolean(intent.transfer_data), false);
    saved.firstIntent = intent.id;
    save();
    const sessionId = `cs_staging_api_${randomUUID()}`;
    checked(
      await admin.from("booking_checkout_time_choices").insert({
        checkout_session_id: sessionId,
        customer_id: user.id,
        preferred_scheduled_at: slots[0],
        optional_scheduled_at: [],
        regular_scheduled_at: regular ? slots : [],
        household_notes: `Disposable staging API test ${label}`,
        cleaning_extras: plan,
      }),
    );
    const params = {
      p_customer: user.id,
      p_session: sessionId,
      p_intent: intent.id,
      p_package: pkg.id,
      p_address: "128 City Road, London, EC1V 2NX",
      p_notes: `Disposable staging API test ${label}`,
      p_frequency: regular ? "weekly" : "one_time",
      p_slots: slots,
      p_optional: [],
      p_preferred_provider: null,
      p_stripe_customer: customer.id,
      p_method: card.id,
      p_first_amount: intent.amount,
      p_email: email,
    };
    let ids;
    try {
      ids = checked(await admin.rpc("finalize_per_visit_checkout", params));
    } catch (failure) {
      // A setup rejection must not leave an orphaned sandbox checkout charge.
      await stripe.refunds.create(
        {
          payment_intent: intent.id,
          amount: intent.amount_received,
          metadata: { staging_fixture_cleanup: runId },
        },
        { idempotencyKey: "matching-fixture-setup-refund:" + intent.id },
      );
      throw failure;
    }
    assert.equal(ids.length, slots.length);
    saved.bookingIds = ids;
    ids.forEach((id) => fixtureIds.add(id));
    save();
    return {
      name,
      user,
      customer,
      card,
      intent,
      params,
      ids,
      plan,
      slots,
      pkg,
      saved,
    };
  }

  const providers = [];
  async function syntheticProvider() {
    const email = `matching-worker-${randomUUID()}@example.invalid`;
    const created = checked(
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          full_name: "Synthetic matching test only",
          staging_api_run: runId,
        },
      }),
    );
    const user = created.user;
    checked(
      await admin.from("profiles").insert({
        id: user.id,
        email,
        full_name: "Synthetic matching test only",
        role: "provider",
      }),
    );
    const provider = checked(
      await admin
        .from("providers")
        .insert({
          profile_id: user.id,
          display_name: "Synthetic matching test only",
          services: ["cleaning"],
          vetting_status: "pending",
          show_on_our_pros: false,
        })
        .select("id")
        .single(),
    );
    providers.push(provider.id);
    // These checks belong only to the NEW clearly marked fictional fixture.
    // No existing person's verification is read or modified.
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("SYNTHETIC STAGING FIXTURE - NOT IDENTITY EVIDENCE");
    const path = `${provider.id}/synthetic-fixture.pdf`;
    checked(
      await admin.storage
        .from("provider-verification")
        .upload(path, await pdf.save(), { contentType: "application/pdf" }),
    );
    const today = new Date().toISOString().slice(0, 10);
    const certificate = String(
      BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 12)}`) %
        1000000000000n,
    ).padStart(12, "0");
    checked(
      await admin.from("provider_dbs_checks").insert({
        provider_id: provider.id,
        certificate_number: certificate,
        issue_date: today,
        status: "verified",
        uploaded_at: new Date().toISOString(),
        certificate_original_name: "synthetic-fixture.pdf",
        certificate_mime_type: "application/pdf",
      }),
    );
    checked(
      await admin.from("provider_verification_items").insert([
        {
          provider_id: provider.id,
          document_type: "right_to_work",
          label: "Synthetic fixture only",
          status: "verified",
          reference: randomUUID().replaceAll("-", "").slice(0, 9).toUpperCase(),
          uploaded_at: new Date().toISOString(),
          gov_uk_checked_on: today,
        },
        {
          provider_id: provider.id,
          document_type: "photo_id",
          label: "Synthetic fixture only",
          status: "verified",
          document_storage_path: path,
          uploaded_at: new Date().toISOString(),
        },
      ]),
    );
    checked(
      await admin
        .from("providers")
        .update({ vetting_status: "approved", dbs_verified: true })
        .eq("id", provider.id),
    );
    checked(
      await admin
        .from("providers")
        .update({ service_approvals: { cleaning: "approved" } })
        .eq("id", provider.id),
    );
    return provider;
  }
  async function assign(id) {
    await own(id);
    const provider = await syntheticProvider();
    checked(
      await admin
        .from("booking_offers")
        .insert({ booking_id: id, provider_id: provider.id, status: "open" }),
    );
    const profile = checked(
      await admin
        .from("providers")
        .select("profile_id")
        .eq("id", provider.id)
        .single(),
    );
    const user = checked(
      await admin.auth.admin.getUserById(profile.profile_id),
    ).user;
    const link = checked(
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: user.email,
      }),
    );
    const client = createClient(
      databaseUrl,
      secrets.VISIT_PAYMENTS_GATEWAY_ANON_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: safeFetch },
      },
    );
    checked(
      await client.auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: "magiclink",
      }),
    );
    const row = await state(id);
    checked(
      await client.rpc("provider_accept_booking_time", {
        p_booking_id: id,
        p_selected_slot: row.booking.scheduled_at,
      }),
    );
    return { ...provider, client };
  }
  async function regularAt(name, hours, options = {}) {
    // Move the clock using private synthetic schedule data, never shared time
    // or an existing customer's records. Weekly slots still follow London DST.
    const later = futureSlot(
      options.addons?.length ? 180 : 120,
      hours,
      hours + 18,
    );
    const first = new Date(later.getTime() - 7 * 86400000);
    return fixture(name, {
      regular: true,
      scheduledAt: first,
      clock: true,
      ...options,
    });
  }
  async function state(id) {
    await own(id);
    return engine.load(id);
  }
  async function evidence(id) {
    const row = await state(id);
    const charges = [];
    for (const c of row.charges) {
      const intent = await stripe.paymentIntents.retrieve(
        c.stripe_payment_intent,
      );
      assert.equal(intent.livemode, false);
      assert.equal(intent.amount_received, c.amount_pence);
      const refunds = await stripe.refunds.list({
        payment_intent: intent.id,
        limit: 100,
      });
      assert.equal(
        refunds.data
          .filter((r) => r.status === "succeeded")
          .reduce((sum, r) => sum + r.amount, 0),
        c.refunded_pence,
      );
      charges.push({
        paymentIntent: intent.id,
        amountPence: c.amount_pence,
        refundedPence: c.refunded_pence,
      });
    }
    return {
      bookingId: id,
      bookingStatus: row.booking.status,
      billingStatus: row.bill.status,
      charges,
    };
  }
  async function notices(id, kind) {
    return checked(
      await admin
        .from("visit_matching_notices")
        .select("id,channel,status,user_id,event_key,title,body")
        .eq("booking_id", id)
        .eq("kind", kind),
    );
  }
  async function intentCount(customer) {
    return (await stripe.paymentIntents.list({ customer, limit: 100 })).data
      .length;
  }
  async function seriesOf(id) {
    const row = await state(id);
    return checked(
      await admin
        .from("regular_booking_series")
        .select("*")
        .eq("id", row.booking.regular_series_id)
        .single(),
    );
  }
  async function pause(id) {
    const series = await seriesOf(id);
    const f = report.fixtures.find((f) => f.bookingIds.includes(id));
    await engine.cancel(f.bookingIds[0], null, true);
    await engine.cancel(f.bookingIds[1], null, true);
    assert.equal((await seriesOf(id)).billing_paused, true);
    return series.id;
  }

  try {
    await caseOf(
      "completed_visit_full_tip_to_assigned_account_once",
      async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = databaseUrl;
        process.env.SUPABASE_SERVICE_ROLE_KEY =
          secrets.SUPABASE_SERVICE_ROLE_KEY;
        process.env.STRIPE_SECRET_KEY = secrets.STRIPE_SECRET_KEY;
        const f = await fixture("completed-tip");
        const id = f.ids[0];
        const provider = await assign(id);
        const connected = await stripe.accounts.create(
          {
            type: "custom",
            country: "GB",
            business_type: "individual",
            business_profile: { url: "https://opulencebliss.com", mcc: "7349" },
            individual: {
              first_name: "Synthetic",
              last_name: "Tip Fixture",
              email: "synthetic-tip@example.invalid",
              dob: { day: 1, month: 1, year: 1990 },
              address: {
                line1: "Test address",
                city: "London",
                postal_code: "EC1V 2NX",
                country: "GB",
              },
            },
            // Synthetic test account only; never used to onboard a real person.
            tos_acceptance: {
              date: Math.floor(Date.now() / 1000),
              ip: "127.0.0.1",
            },
            capabilities: { transfers: { requested: true } },
            metadata: {
              staging_audit: runId,
              synthetic_fixture: "tip recipient only",
            },
          },
          { idempotencyKey: runId + ":tip-account" },
        );
        f.saved.tipAccount = connected.id;
        save();
        checked(
          await admin
            .from("providers")
            .update({ stripe_account_id: connected.id })
            .eq("id", provider.id),
        );
        checked(
          await provider.client.rpc("transition_booking", {
            p_booking_id: id,
            p_to_status: "in_progress",
            p_reason: "Synthetic staging completion test",
          }),
        );
        checked(
          await provider.client.rpc("transition_booking", {
            p_booking_id: id,
            p_to_status: "completed",
            p_reason: "Synthetic staging completion test",
          }),
        );
        const intent = await stripe.paymentIntents.create(
          {
            amount: 300,
            currency: "gbp",
            customer: f.customer.id,
            payment_method: f.card.id,
            payment_method_types: ["card"],
            confirm: true,
            metadata: { kind: "tip", booking_id: id, staging_audit: runId },
            transfer_group: "ob_tip_" + id,
          },
          { idempotencyKey: runId + ":tip-payment" },
        );
        assert.equal(intent.status, "succeeded");
        assert.equal(intent.livemode, false);
        assert.equal(Boolean(intent.transfer_data), false);
        const { finalizeTipCheckout } = load("lib/finalizeTipCheckout.ts");
        const session = {
          mode: "payment",
          payment_status: "paid",
          client_reference_id: f.user.id,
        };
        const first = await finalizeTipCheckout(session, intent);
        const again = await finalizeTipCheckout(session, intent);
        assert.equal(first.paymentId, again.paymentId);
        const payouts = checked(
          await admin
            .from("payouts")
            .select("id,status,amount,stripe_transfer_ref")
            .eq("payment_id", first.paymentId),
        );
        assert.equal(payouts.length, 1);
        assert.equal(Number(payouts[0].amount), 3);
        assert.equal(
          payouts[0].status,
          "paid",
          "Full tip must reach the assigned test account",
        );
        const transfer = await stripe.transfers.retrieve(
          payouts[0].stripe_transfer_ref,
        );
        assert.equal(transfer.destination, connected.id);
        assert.equal(transfer.amount, 300);
        assert.equal(transfer.livemode, false);
        return {
          bookingId: id,
          paymentIntent: intent.id,
          amountPence: 300,
          transferId: transfer.id,
          assignedTestAccount: connected.id,
          payoutId: payouts[0].id,
          replayDeduplicated: true,
        };
      },
    );
    await caseOf(
      "rescheduled_visit_cannot_send_its_stale_matching_warning",
      async () => {
        const f = await regularAt("stale-notice", 36);
        const id = f.ids[1];
        await engine.tick(100, [id]);
        const n = (await notices(id, "admin_48h")).find(
          (n) => n.channel === "email",
        );
        assert.ok(n);
        const token = randomUUID();
        checked(
          await admin
            .from("visit_matching_notices")
            .update({
              status: "processing",
              claim_token: token,
              claimed_at: new Date().toISOString(),
            })
            .eq("id", n.id),
        );
        checked(
          await admin.rpc("system_reschedule_booking", {
            p_booking_id: id,
            p_new_slot: futureSlot(120, 60, 78).toISOString(),
            p_reason: "Owned staging stale-warning fixture",
            p_meta: { staging_api_run: runId },
          }),
        );
        assert.equal(
          checked(
            await admin.rpc("visit_matching_notice_allowed", {
              p_id: n.id,
              p_token: token,
            }),
          ),
          false,
        );
        checked(
          await admin.rpc("finish_visit_matching_notice", {
            p_id: n.id,
            p_token: token,
            p_reference: null,
            p_error: "Notice no longer applies.",
          }),
        );
        assert.equal(
          checked(
            await admin
              .from("visit_matching_notices")
              .select("status")
              .eq("id", n.id)
              .single(),
          ).status,
          "cancelled",
        );
        return {
          bookingId: id,
          staleEmailCancelled: true,
          externalEmailRequests: 0,
        };
      },
    );
    await caseOf(
      "expired_card_update_window_cancels_without_another_charge",
      async () => {
        const f = await regularAt("expired-grace", 12);
        const id = f.ids[1];
        await assign(id);
        await cardFor(f.customer.id, true);
        assert.equal((await engine.chargeVisit(id)).status, "failed");
        const before = await intentCount(f.customer.id);
        const command = resolve(
          root,
          "artifacts/expire-owned-staging-grace.sql",
        );
        const acknowledgement = resolve(
          root,
          `artifacts/expire-owned-staging-grace-${runId}.json`,
        );
        writeFileSync(
          command,
          `begin;\ndo $fixture$\nbegin\n if not exists(select 1 from public.bookings b join auth.users u on u.id=b.customer_id where b.id='${id}' and u.raw_user_meta_data->>'staging_api_run'='${runId}') then raise exception 'Not this disposable fixture';end if;\n update public.booking_visit_billing set late_payment_grace_until=now()-interval '1 second' where booking_id='${id}';\nend;\n$fixture$;\ncommit;\nselect booking_id,late_payment_grace_until<now() as fixture_window_expired from public.booking_visit_billing where booking_id='${id}';\n`,
        );
        console.log(
          JSON.stringify({
            phase: "owned_fixture_clock_ready",
            bookingId: id,
            runId,
            command,
            acknowledgement,
          }),
        );
        const until = Date.now() + 240000;
        while (!existsSync(acknowledgement) && Date.now() < until)
          await new Promise((r) => setTimeout(r, 500));
        assert.ok(
          existsSync(acknowledgement),
          "The isolated fixture clock update was not acknowledged",
        );
        await engine.chargeVisit(id);
        await engine.tick(100, [id]);
        assert.equal((await state(id)).booking.status, "cancelled");
        assert.equal(await intentCount(f.customer.id), before);
        return {
          visit: await evidence(id),
          fixtureClockAdvanced: true,
          noNewChargeAfterWindow: true,
        };
      },
    );
    await caseOf(
      "delayed_extra_refund_preserves_base_payment_and_blocks_recharge",
      async () => {
        const { londonDate, londonParts } = load("lib/appointmentWindow.ts");
        const d = londonParts(Date.now() - 8 * 86400000);
        const f = await fixture("delayed-extra", {
          regular: true,
          scheduledAt: londonDate(d.year, d.month, d.day, 10),
          clock: true,
        });
        const id = f.ids[2];
        await assign(id);
        checked(
          await admin.rpc("system_reschedule_booking", {
            p_booking_id: id,
            p_new_slot: futureSlot(180, 25, 47).toISOString(),
            p_reason: "Owned staging extras race fixture",
            p_meta: { staging_api_run: runId },
          }),
        );
        assert.equal((await engine.chargeVisit(id)).status, "succeeded");
        const quote = await engine.quoteExtras(id, f.user.id, {
          addons: ["oven"],
          bringsProducts: false,
        });
        const op = checked(
          await admin.rpc("prepare_visit_money_operation", {
            p_booking: id,
            p_actor: f.user.id,
            p_type: "extras",
            p_revision: quote.revision,
            p_parameters: quote,
          }),
        );
        await stripe.paymentIntents.create(
          {
            amount: quote.chargePence,
            currency: "gbp",
            customer: f.customer.id,
            payment_method: f.card.id,
            payment_method_types: ["card"],
            confirm: true,
            off_session: true,
            metadata: {
              kind: "staging_billing_audit",
              booking_id: id,
              visit_operation: op.id,
            },
          },
          { idempotencyKey: op.idempotency_key + ":create" },
        );
        await pause(id);
        await engine.run(op.id);
        await engine.run(op.id);
        const before = await intentCount(f.customer.id);
        await engine.chargeVisit(id);
        const row = await state(id);
        assert.equal(row.bill.status, "review");
        assert.equal(row.charges.length, 2);
        assert.equal(row.charges[0].refunded_pence, 0);
        assert.equal(row.charges[1].refunded_pence, 2000);
        assert.equal(await intentCount(f.customer.id), before);
        await assert.rejects(
          engine.quoteExtras(id, f.user.id, {
            addons: [],
            bringsProducts: false,
          }),
          /team review/,
        );
        return {
          visit: await evidence(id),
          baseNotRefundedOrChargedAgain: true,
          manualReviewRequired: true,
        };
      },
    );
    await caseOf(
      "unassigned_48h_and_24h_never_charge_alerts_deduplicate",
      async () => {
        const f = await regularAt("unassigned-warning", 11, {
          addons: ["fridge"],
          products: true,
        });
        const id = f.ids[1];
        const before = await intentCount(f.customer.id);
        await engine.tick(100, [id]);
        await engine.tick(100, [id]);
        const row = await state(id);
        assert.equal(row.bill.status, "unpaid");
        assert.equal(row.bill.attempts, 0);
        assert.equal(row.booking.status, "offered");
        assert.equal(await intentCount(f.customer.id), before);
        const warning = await notices(id, "customer_24h");
        assert.equal(warning.filter((n) => n.channel === "in_app").length, 1);
        assert.equal(
          warning.filter((n) => n.channel === "email" && n.status === "pending")
            .length,
          1,
        );
        assert.ok(
          (await notices(id, "admin_48h")).some((n) => n.channel === "in_app"),
        );
        for (const visit of f.ids)
          assert.equal(
            (await state(visit)).bill.line_items.find(
              (l) => l.id === "products",
            ).amountPence,
            500,
          );
        return {
          visit: await evidence(id),
          customerWarningQueued: true,
          emailSent: false,
          duplicateNotices: false,
        };
      },
    );
    await caseOf("weeks_ahead_not_cancelled_by_old_offer_expiry", async () => {
      const f = await fixture("future-expiry");
      const id = f.ids[0];
      const row = await state(id);
      checked(
        await admin.rpc("system_reschedule_booking", {
          p_booking_id: id,
          p_new_slot: new Date(
            Date.parse(row.booking.scheduled_at) + 1800000,
          ).toISOString(),
          p_reason: "Synthetic future visit with a stale offer expiry",
          p_meta: {
            offer_expires_at: new Date(Date.now() - 1000).toISOString(),
            staging_api_run: runId,
          },
        }),
      );
      await engine.tick(100, [id]);
      assert.equal((await state(id)).booking.status, "offered");
      return { visit: await evidence(id) };
    });
    await caseOf(
      "assigned_later_visit_charges_once_and_delayed_retry_does_not_duplicate",
      async () => {
        const f = await regularAt("assigned-charge", 36);
        const id = f.ids[1];
        await assign(id);
        assert.equal((await engine.chargeVisit(id)).status, "succeeded");
        await engine.chargeVisit(id);
        await engine.tick(100, [id]);
        const row = await state(id);
        assert.equal(row.charges.length, 1);
        assert.equal(row.bill.status, "paid");
        const op = checked(
          await admin
            .from("booking_visit_money_operations")
            .select("id")
            .eq("booking_id", id)
            .eq("operation_type", "charge")
            .single(),
        );
        assert.equal((await engine.run(op.id)).status, "succeeded");
        assert.equal((await state(id)).charges.length, 1);
        return {
          visit: await evidence(id),
          totalIntents: await intentCount(f.customer.id),
        };
      },
    );
    await caseOf(
      "two_consecutive_unmatched_pause_remaining_and_refund_only_paid_first",
      async () => {
        const { londonDate, londonParts } = load("lib/appointmentWindow.ts");
        const d = londonParts(Date.now() - 8 * 86400000);
        const first = londonDate(d.year, d.month, d.day, 10);
        const f = await fixture("two-unmatched", {
          regular: true,
          scheduledAt: first,
          clock: true,
        });
        await engine.tick(100, f.ids);
        await engine.tick(100, f.ids);
        const series = await seriesOf(f.ids[0]);
        assert.equal(series.billing_paused, true);
        assert.equal(series.pause_generation, 1);
        assert.equal((await state(f.ids[0])).booking.status, "cancelled");
        assert.equal((await state(f.ids[1])).booking.status, "cancelled");
        for (const id of f.ids.slice(2)) {
          const row = await state(id);
          assert.equal(row.charges.length, 0);
          assert.equal(row.bill.attempts, 0);
          assert.equal((await engine.chargeVisit(id)).status, "blocked");
        }
        const firstEvidence = await evidence(f.ids[0]);
        assert.equal(
          firstEvidence.charges[0].refundedPence,
          firstEvidence.charges[0].amountPence,
        );
        assert.equal(await intentCount(f.customer.id), 1);
        const all = checked(
          await admin
            .from("visit_matching_notices")
            .select("id,channel,user_id,event_key")
            .eq("series_id", series.id)
            .eq("kind", "series_paused"),
        );
        assert.equal(
          all.filter((n) => n.user_id === f.user.id && n.channel === "in_app")
            .length,
          1,
        );
        assert.equal(
          all.filter((n) => n.user_id === f.user.id && n.channel === "email")
            .length,
          1,
        );
        const cancelled = await notices(f.ids[1], "unmatched_cancelled");
        assert.ok(
          cancelled.some((n) => n.body.includes("No payment was taken")),
        );
        // Authenticated owner only; wrong user and stale generation cannot resume.
        const link = checked(
          await admin.auth.admin.generateLink({
            type: "magiclink",
            email: f.user.email,
          }),
        );
        const client = createClient(
          databaseUrl,
          secrets.VISIT_PAYMENTS_GATEWAY_ANON_KEY,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { fetch: safeFetch },
          },
        );
        checked(
          await client.auth.verifyOtp({
            token_hash: link.properties.hashed_token,
            type: "magiclink",
          }),
        );
        assert.ok(
          (
            await client.rpc("resume_regular_series", {
              p_series: series.id,
              p_generation: 0,
            })
          ).error,
        );
        checked(
          await client.rpc("resume_regular_series", {
            p_series: series.id,
            p_generation: 1,
          }),
        );
        assert.equal((await seriesOf(f.ids[0])).billing_paused, false);
        assert.equal((await state(f.ids[0])).booking.status, "cancelled");
        return {
          seriesId: series.id,
          firstVisit: firstEvidence,
          secondVisit: await evidence(f.ids[1]),
          remainingNeverCharged: true,
          pauseNoticeOnce: true,
          explicitOwnerResumePassed: true,
          emailSent: false,
        };
      },
    );
    await caseOf(
      "paused_prepared_operation_and_delayed_capture_refund_once",
      async () => {
        const { londonDate, londonParts } = load("lib/appointmentWindow.ts");
        const d = londonParts(Date.now() - 8 * 86400000);
        const f = await fixture("delayed-capture", {
          regular: true,
          scheduledAt: londonDate(d.year, d.month, d.day, 10),
          clock: true,
        });
        const id = f.ids[2];
        await assign(id);
        checked(
          await admin.rpc("system_reschedule_booking", {
            p_booking_id: id,
            p_new_slot: futureSlot(120, 25, 47).toISOString(),
            p_reason:
              "Move only the owned synthetic accepted visit into its charge window",
            p_meta: { staging_api_run: runId },
          }),
        );
        const row = await state(id);
        const op = checked(
          await admin.rpc("prepare_visit_money_operation", {
            p_booking: id,
            p_actor: null,
            p_type: "charge",
            p_revision: row.bill.revision,
            p_parameters: {
              amountPence: row.bill.amount_pence,
              lines: row.bill.line_items,
            },
          }),
        );
        // Stripe completed but the app never received the result before a pause.
        const pi = await stripe.paymentIntents.create(
          {
            amount: row.bill.amount_pence,
            currency: "gbp",
            customer: f.customer.id,
            payment_method: f.card.id,
            payment_method_types: ["card"],
            confirm: true,
            off_session: true,
            metadata: {
              kind: "staging_billing_audit",
              booking_id: id,
              visit_operation: op.id,
            },
          },
          { idempotencyKey: op.idempotency_key + ":create" },
        );
        await pause(id);
        assert.equal((await engine.run(op.id)).status, "succeeded");
        await engine.run(op.id);
        await engine.tick(100, [id]);
        const after = await state(id);
        assert.equal(after.charges.length, 1);
        assert.equal(after.charges[0].stripe_payment_intent, pi.id);
        assert.equal(after.charges[0].refunded_pence, row.bill.amount_pence);
        assert.equal((await seriesOf(id)).billing_paused, true);
        assert.equal(after.bill.policy_refund_required, false);
        assert.equal(await intentCount(f.customer.id), 2);
        return {
          visit: await evidence(id),
          seriesStillPaused: true,
          latePaymentRefundedExactlyOnce: true,
        };
      },
    );
    await caseOf(
      "late_failure_grace_window_does_not_extend_and_card_update_recovers",
      async () => {
        const f = await regularAt("late-grace", 12);
        const id = f.ids[1];
        await assign(id);
        await cardFor(f.customer.id, true);
        const failedAt = Date.now();
        assert.equal((await engine.chargeVisit(id)).status, "failed");
        let row = await state(id);
        assert.equal(row.booking.status, "scheduled");
        assert.equal(row.bill.status, "failed");
        const end = Date.parse(row.bill.late_payment_grace_until);
        assert.ok(
          end >= failedAt + 119 * 60000 && end <= Date.now() + 121 * 60000,
        );
        checked(
          await admin.rpc("retry_assigned_customer_visits", {
            p_customer: f.customer.id,
          }),
        );
        await engine.chargeVisit(id);
        assert.equal(
          (await state(id)).bill.late_payment_grace_until,
          row.bill.late_payment_grace_until,
        );
        await cardFor(f.customer.id);
        checked(
          await admin.rpc("retry_assigned_customer_visits", {
            p_customer: f.customer.id,
          }),
        );
        assert.equal((await engine.chargeVisit(id)).status, "succeeded");
        row = await state(id);
        assert.equal(row.bill.status, "paid");
        assert.equal(row.charges.length, 1);
        return {
          visit: await evidence(id),
          windowEnd: new Date(end).toISOString(),
          retriesDoNotExtendWindow: true,
        };
      },
    );
    await caseOf(
      "one_off_two_hour_unmatched_deadline_full_refund_and_notice",
      async () => {
        const f = await fixture("oneoff-unmatched", {
          scheduledAt: (() => {
            const { londonDate, londonParts } = load(
              "lib/appointmentWindow.ts",
            );
            const d = londonParts(Date.now());
            return londonDate(d.year, d.month, d.day, 10);
          })(),
          clock: true,
        });
        const id = f.ids[0];
        await engine.tick(100, [id]);
        await engine.tick(100, [id]);
        const row = await state(id);
        assert.equal(row.booking.status, "cancelled");
        assert.equal(
          row.charges[0].refunded_pence,
          row.charges[0].amount_pence,
        );
        const ns = await notices(id, "unmatched_cancelled");
        assert.equal(ns.filter((n) => n.channel === "email").length, 1);
        assert.equal(ns.filter((n) => n.channel === "in_app").length, 1);
        return {
          visit: await evidence(id),
          emailQueued: true,
          emailSent: false,
        };
      },
    );
  } finally {
    // Retain the audit/payment trail, but never let synthetic professionals
    // receive another customer's work after these tests.
    for (const id of providers)
      checked(
        await admin
          .from("providers")
          .update({ is_suspended: true })
          .eq("id", id),
      );
    report.finishedAt = new Date().toISOString();
    report.syntheticProvidersSuspended = providers.length;
    save();
    console.log(
      JSON.stringify({
        report: reportPath,
        passed: report.cases.filter((c) => c.passed).length,
        failed: report.cases.filter((c) => !c.passed).length,
        productionChanged: false,
      }),
    );
  }
}

try {
  assert.ok(secrets.STRIPE_SECRET_KEY.startsWith("sk_test_"));
  const stripe = new Stripe(secrets.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
  });
  assert.equal((await stripe.accounts.retrieveCurrent()).id, expectedAccount);
  const packages = checked(
    await admin
      .from("packages")
      .select("id,name,price,duration_minutes,service_type,billing_type")
      .in("name", ["Essential Clean", "One-Time Essential Clean"]),
  );
  await runSuite(admin, stripe, packages);
} catch (error) {
  console.error(sanitized(error.message));
  process.exitCode = 1;
}
