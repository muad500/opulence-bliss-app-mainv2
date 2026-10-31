import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url),
  cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const compiledModule = { exports: {} };
  cache.set(path, compiledModule.exports);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    Date,
    console,
    process,
    require: (id) => {
      if (id === "server-only") return {};
      if (id.startsWith("."))
        return load("lib/" + id.replace("./", "") + ".ts");
      return require(id);
    },
  });
  return compiledModule.exports;
}
const { regularSeriesControlPlan } = load("lib/regularSeriesControl.ts");
const now = new Date("2026-11-10T10:00:00Z");
function fixture({ foreign = false, active = false } = {}) {
  const series = {
    id: "series",
    customer_id: foreign ? "stranger" : "customer",
    billing_paused: false,
    pause_generation: 2,
    ended_at: null,
  };
  const query = (data) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    gt() {
      return this;
    },
    order() {
      return Promise.resolve({ data });
    },
    single() {
      return Promise.resolve({ data });
    },
  });
  const admin = {
    from: (table) =>
      query(
        table === "regular_booking_series"
          ? series
          : [{ id: "assigned" }, { id: "unmatched" }],
      ),
  };
  const charge = {
    id: "charge",
    stripe_payment_intent: "pi_fixture",
    amount_pence: 4598,
    refunded_pence: 0,
    refunded_lines: {},
    line_items: [{ id: "cleaning", amountPence: 4598, reservedMinutes: 120 }],
  };
  const engine = {
    load: async (id) => ({
      booking: {
        id,
        customer_id: "customer",
        provider_id: id === "assigned" ? "provider" : null,
        scheduled_at: "2026-11-11T22:00:00Z",
        created_at: "2026-09-01T10:00:00Z",
      },
      bill: {
        revision: 5,
        active_operation_id: active ? "operation" : null,
        status: id === "assigned" ? "paid" : "unpaid",
        policy_refund_required: false,
      },
      charges: id === "assigned" ? [charge] : [],
      terms: {
        cancellationBasis: "booking_total",
        cancellationRefundPercent: {
          full: 100,
          three_quarter: 75,
          half: 50,
          none: 30,
        },
      },
    }),
  };
  return { admin, engine };
}
test("pause previews a paid visit's original band and pauses only unassigned unpaid visits", async () => {
  const f = fixture();
  const plan = await regularSeriesControlPlan(
    f.admin,
    f.engine,
    "series",
    "customer",
    "pause",
    now,
  );
  assert.equal(plan.visits[0].cancel, true);
  assert.equal(plan.refundPence, 3448);
  assert.equal(plan.retainedPence, 1150);
  assert.equal(plan.visits[1].cancel, false);
  assert.equal(plan.visits[1].retainedPence, 0);
  assert.equal(
    (
      await regularSeriesControlPlan(
        f.admin,
        f.engine,
        "series",
        "customer",
        "pause",
        now,
      )
    ).fingerprint,
    plan.fingerprint,
  );
  const end = await regularSeriesControlPlan(
    f.admin,
    f.engine,
    "series",
    "customer",
    "end",
    now,
  );
  assert.equal(end.visits[1].cancel, true);
  assert.notEqual(end.fingerprint, plan.fingerprint);
});
test("series controls fail before preparing any money when ownership or payment recovery is unresolved", async () => {
  let f = fixture({ foreign: true });
  await assert.rejects(
    regularSeriesControlPlan(
      f.admin,
      f.engine,
      "series",
      "customer",
      "pause",
      now,
    ),
    /not found/,
  );
  f = fixture({ active: true });
  await assert.rejects(
    regularSeriesControlPlan(
      f.admin,
      f.engine,
      "series",
      "customer",
      "end",
      now,
    ),
    /processing/,
  );
});

async function routeFixture({ actor = "worker", crossBooking = false } = {}) {
  const { NextRequest, NextResponse } = await import("next/server.js");
  const calls = [];
  const bookingId = "11111111-1111-4111-8111-111111111111";
  const offerId = "22222222-2222-4222-8222-222222222222";
  const context = {
    user: { id: actor },
    providerId: actor === "worker" ? "provider" : null,
    admin: {
      from(table) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async single() {
            calls.push("read:" + table);
            return {
              data:
                table === "bookings"
                  ? { customer_id: "customer", provider_id: "provider" }
                  : { booking_id: crossBooking ? "other" : bookingId },
              error: null,
            };
          },
        };
      },
      async rpc(name) {
        calls.push(name);
        return {
          data: { status: "paid", operation: "operation" },
          error: null,
        };
      },
    },
  };
  const compiledModule = { exports: {} };
  const mocks = {
    "next/server": { NextRequest, NextResponse },
    "@/lib/accountApi": {
      accountContext: async () => context,
      isAccountError: () => false,
      readAccountBody: (request) => request.json(),
    },
    "@/lib/supabase/server": {
      createClient: async () => ({
        rpc: async (name) => {
          calls.push(name);
          return { error: null };
        },
      }),
    },
    "@/lib/visitBillingServer": {
      createVisitBilling: () => {
        calls.push("billing engine");
        throw Error("No new charge should start");
      },
    },
    stripe: {
      __esModule: true,
      default: class Stripe {
        static errors = { StripeError: Error };
        constructor() {
          calls.push("Stripe");
        }
      },
    },
  };
  const code = ts.transpileModule(
    readFileSync("app/api/cleaning-extra-hours/[id]/route.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) => mocks[id] ?? require(id),
    process,
    Number,
    Response,
  });
  const post = (body) =>
    compiledModule.exports.POST(
      new NextRequest(
        "https://staging.example/api/cleaning-extra-hours/" + bookingId,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://staging.example",
          },
          body: JSON.stringify(body),
        },
      ),
      { params: Promise.resolve({ id: bookingId }) },
    );
  return { calls, post, offerId };
}
test("the cleaner cannot approve their own extra-time payment", async () => {
  const f = await routeFixture();
  const response = await f.post({
    action: "approve",
    confirm: true,
    amountPence: 2299,
    offerId: f.offerId,
  });
  assert.equal(response.status, 400);
  assert.ok(!f.calls.includes("prepare_cleaning_extra_hours"));
  assert.ok(!f.calls.includes("Stripe"));
});
test("an unconfirmed or cross-booking request cannot prepare a payment", async () => {
  let f = await routeFixture({ actor: "customer" });
  assert.equal(
    (await f.post({ action: "approve", amountPence: 2299, offerId: f.offerId }))
      .status,
    400,
  );
  assert.equal(f.calls.length, 0);
  f = await routeFixture({ actor: "customer", crossBooking: true });
  assert.equal(
    (
      await f.post({
        action: "approve",
        confirm: true,
        amountPence: 2299,
        offerId: f.offerId,
      })
    ).status,
    404,
  );
  assert.ok(!f.calls.includes("prepare_cleaning_extra_hours"));
});
test("repeating a paid approval acknowledges the existing operation without creating a Stripe client", async () => {
  const f = await routeFixture({ actor: "customer" });
  const response = await f.post({
    action: "approve",
    confirm: true,
    amountPence: 2299,
    offerId: f.offerId,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "succeeded");
  assert.deepEqual(
    f.calls.filter((c) => c === "prepare_cleaning_extra_hours"),
    ["prepare_cleaning_extra_hours"],
  );
  assert.ok(!f.calls.includes("Stripe"));
});
test("declining an offer never starts the payment engine", async () => {
  const f = await routeFixture({ actor: "customer" });
  assert.equal(
    (await f.post({ action: "decline", confirm: true, offerId: f.offerId }))
      .status,
    200,
  );
  assert.ok(f.calls.includes("decline_cleaning_extra_hours"));
  assert.ok(!f.calls.includes("prepare_cleaning_extra_hours"));
  assert.ok(!f.calls.includes("Stripe"));
});
