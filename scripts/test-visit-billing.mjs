import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import Stripe from "stripe";
const require = createRequire(import.meta.url);

function fixture({
  lostConfirm = false,
  lostCreateCheckpoint = false,
  declined = false,
  oldUnknown = false,
  lostRefund = false,
  extras = false,
  unassigned = false,
  paused = false,
  pauseAfterCreate = false,
  cancellationAdjustment = false,
  lostReversal = false,
} = {}) {
  const calls = [];
  const lines = [
    {
      id: "cleaning",
      label: "Cleaning",
      amountPence: 5000,
      reservedMinutes: 120,
    },
  ];
  const state = {
    booking: {
      id: "booking",
      customer_id: "user",
      status: "scheduled",
      provider_id: unassigned ? null : "provider",
      scheduled_at: new Date(Date.now() + 40 * 3_600_000).toISOString(),
    },
    bill: {
      booking_id: "booking",
      stripe_customer_id: "cus_fixture",
      stripe_payment_method_id: "pm_fixture",
      status: "charging",
    },
    op: {
      id: "operation",
      booking_id: "booking",
      status: "prepared",
      operation_type: cancellationAdjustment
        ? "cancellation_adjustment"
        : extras
          ? "extras"
          : "charge",
      revision: 1,
      idempotency_key: "visit:operation",
      created_at: new Date(
        Date.now() - (oldUnknown ? 25 * 3_600_000 : 0),
      ).toISOString(),
      stripe_objects: [],
      parameters: {
        amountPence: 5000,
        chargePence: cancellationAdjustment ? 0 : 1000,
        lines,
        added: [
          {
            id: "fridge",
            label: "Fridge",
            amountPence: 1000,
            reservedMinutes: 60,
          },
        ],
        oldStatus: extras ? "paid" : "unpaid",
        scheduledAt: new Date(Date.now() + 40 * 3_600_000).toISOString(),
        reversals: cancellationAdjustment
          ? [
              {
                chargeId: "charge",
                transferId: "tr_cleaner",
                amountPence: 2000,
              },
            ]
          : [],
        refunds:
          extras || cancellationAdjustment
            ? [
                {
                  chargeId: "charge",
                  intentId: "pi_old",
                  amountPence: 2000,
                  refundedLines: { oven: 2000 },
                },
              ]
            : [],
      },
    },
    intents: [],
    refunds: [],
    reversals: [],
    paused,
  };
  const db = {
    from(table) {
      let update;
      const q = {
        select: () => q,
        eq: () => q,
        single: () => q,
        maybeSingle: () => q,
        order: () => q,
        update: (value) => {
          update = value;
          return q;
        },
        then(resolve, reject) {
          if (update) {
            calls.push("db-checkpoint");
            if (
              lostCreateCheckpoint &&
              state.intents.length &&
              !state.op.stripe_objects.length
            ) {
              lostCreateCheckpoint = false;
              return reject(new Error("database timeout"));
            }
            Object.assign(state.op, structuredClone(update));
            return resolve({ data: null, error: null });
          }
          resolve({
            data: structuredClone(
              table === "bookings"
                ? state.booking
                : table === "booking_visit_billing"
                  ? state.bill
                  : table === "booking_visit_charges"
                    ? []
                    : table === "booking_cleaning_billing_terms"
                      ? null
                      : state.op,
            ),
            error: null,
          });
        },
      };
      return q;
    },
    async rpc(name, input) {
      if (name === "visit_charge_gate") {
        const assigned = Boolean(state.booking.provider_id);
        const allowed = !state.paused && (extras || assigned);
        return {
          data: {
            allowed,
            assigned,
            paused: state.paused,
            reason: state.paused
              ? "series_paused"
              : assigned || extras
                ? null
                : "cleaner_unassigned",
          },
          error: null,
        };
      }
      if (name === "claim_visit_money_operation") {
        if (["succeeded", "failed"].includes(state.op.status))
          return { data: null, error: null };
        state.op.status = "running";
        return { data: structuredClone(state.op), error: null };
      }
      if (name === "finish_visit_money_operation") {
        calls.push(`finish:${input.p_outcome}`);
        state.op.status =
          input.p_outcome === "blocked" ? "failed" : input.p_outcome;
        state.op.stripe_objects = structuredClone(input.p_results);
        return { data: null, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const stripe = {
    transfers: {
      async listReversals() {
        return { data: structuredClone(state.reversals) };
      },
      async createReversal(transfer, parameters) {
        calls.push("reversal");
        const reversal = { ...parameters, id: "trr_fixture", transfer };
        state.reversals.push(reversal);
        if (lostReversal) {
          lostReversal = false;
          throw new Stripe.errors.StripeConnectionError({
            message: "lost reversal response",
          });
        }
        return structuredClone(reversal);
      },
    },
    customers: {
      retrieve: async () => ({
        invoice_settings: { default_payment_method: "pm_fixture" },
      }),
    },
    paymentMethods: {
      retrieve: async () => ({ type: "card", customer: "cus_fixture" }),
    },
    paymentIntents: {
      list() {
        return {
          async *[Symbol.asyncIterator]() {
            for (const intent of state.intents) yield structuredClone(intent);
          },
        };
      },
      async retrieve(id) {
        return structuredClone(
          state.intents.find((intent) => intent.id === id),
        );
      },
      async create(parameters) {
        calls.push("create");
        const intent = {
          ...parameters,
          id: "pi_new",
          status: "requires_confirmation",
          created: Math.floor(Date.now() / 1000),
        };
        state.intents.push(intent);
        if (pauseAfterCreate) state.paused = true;
        return structuredClone(intent);
      },
      async confirm(id) {
        calls.push("confirm");
        const intent = state.intents.find((intent) => intent.id === id);
        if (declined) {
          intent.status = "requires_payment_method";
          throw new Stripe.errors.StripeCardError({ message: "declined" });
        }
        intent.status = "succeeded";
        intent.amount_received = intent.amount;
        if (lostConfirm) {
          lostConfirm = false;
          throw new Stripe.errors.StripeConnectionError({
            message: "lost confirm response",
          });
        }
        return structuredClone(intent);
      },
      async cancel(id) {
        calls.push("cancel");
        const intent = state.intents.find((intent) => intent.id === id);
        intent.status = "canceled";
        return structuredClone(intent);
      },
    },
    refunds: {
      async list() {
        return { data: structuredClone(state.refunds) };
      },
      async create(parameters) {
        calls.push("refund");
        const refund = { ...parameters, id: "re_fixture", status: "succeeded" };
        state.refunds.push(refund);
        if (lostRefund) {
          lostRefund = false;
          throw new Stripe.errors.StripeConnectionError({
            message: "lost refund response",
          });
        }
        return structuredClone(refund);
      },
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const compiledModule = { exports: {} };
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const resolve = (id) =>
      id === "server-only"
        ? {}
        : id === "stripe"
          ? Stripe
          : id.startsWith("./")
            ? load(`lib/${id.slice(2)}.ts`)
            : require(id);
    vm.runInNewContext(code, {
      module: compiledModule,
      exports: compiledModule.exports,
      require: resolve,
      process,
      Date,
      console,
      Buffer,
    });
    cache.set(path, compiledModule.exports);
    return compiledModule.exports;
  }
  return {
    engine: load("lib/visitBillingServer.ts").createVisitBilling(db, stripe),
    state,
    calls,
  };
}

test("lost confirmation response reconciles the known intent, and a delayed repeat never charges again", async () => {
  const h = fixture({ lostConfirm: true });
  assert.equal((await h.engine.run("operation")).status, "processing");
  assert.equal((await h.engine.run("operation")).status, "succeeded");
  assert.equal((await h.engine.run("operation")).status, "succeeded");
  assert.equal(h.calls.filter((call) => call === "create").length, 1);
  assert.equal(h.calls.filter((call) => call === "confirm").length, 1);
  assert.ok(h.calls.indexOf("db-checkpoint") < h.calls.indexOf("confirm"));
});
test("lost ID checkpoint recovers the unconfirmed intent by operation metadata", async () => {
  const h = fixture({ lostCreateCheckpoint: true });
  assert.equal((await h.engine.run("operation")).status, "processing");
  assert.equal(h.calls.filter((call) => call === "confirm").length, 0);
  assert.equal((await h.engine.run("operation")).status, "succeeded");
  assert.equal(h.calls.filter((call) => call === "create").length, 1);
});
test("card decline closes the failed intent before releasing the operation for retry", async () => {
  const h = fixture({ declined: true });
  assert.equal((await h.engine.run("operation")).status, "failed");
  assert.equal(h.state.intents[0].status, "canceled");
  assert.equal(h.state.op.status, "failed");
});
test("unknown operation beyond Stripe key retention cannot be blindly recreated", async () => {
  const h = fixture({ oldUnknown: true });
  assert.equal((await h.engine.run("operation")).status, "processing");
  assert.equal(h.calls.includes("create"), false);
});
test("a paid extra swap with lost refund response recovers without another charge or refund", async () => {
  const h = fixture({ extras: true, lostRefund: true });
  assert.equal((await h.engine.run("operation")).status, "processing");
  assert.equal((await h.engine.run("operation")).status, "succeeded");
  assert.equal(h.calls.filter((call) => call === "confirm").length, 1);
  assert.equal(h.calls.filter((call) => call === "refund").length, 1);
  assert.equal(h.state.op.stripe_objects.length, 2);
});

test("an unassigned later visit cannot create or confirm a payment", async () => {
  const h = fixture({ unassigned: true });
  assert.equal((await h.engine.run("operation")).status, "blocked");
  assert.equal(h.calls.includes("create"), false);
  assert.equal(h.calls.includes("confirm"), false);
});

test("a paused series blocks a previously selected or prepared charge", async () => {
  const h = fixture({ paused: true });
  assert.equal((await h.engine.run("operation")).status, "blocked");
  assert.equal(h.state.intents.length, 0);
  h.state.paused = false;
  assert.equal((await h.engine.run("operation")).status, "failed");
  assert.equal(
    h.state.intents.length,
    0,
    "A delayed event cannot revive the old attempt after resume",
  );
});

test("a pause after intent creation closes the unconfirmed intent without charging", async () => {
  const h = fixture({ pauseAfterCreate: true });
  assert.equal((await h.engine.run("operation")).status, "blocked");
  assert.equal(h.state.intents.length, 1);
  assert.equal(h.state.intents[0].status, "canceled");
  assert.equal(h.calls.includes("confirm"), false);
});

test("paid add-on charges also respect a series pause", async () => {
  const h = fixture({ extras: true, paused: true });
  assert.equal((await h.engine.run("operation")).status, "blocked");
  assert.equal(h.calls.includes("create"), false);
  assert.equal(h.calls.includes("refund"), false);
});

test("a cleaner waiver reverses the paid cleaner transfer before refunding, and lost responses never duplicate money", async () => {
  const h = fixture({
    cancellationAdjustment: true,
    lostReversal: true,
    lostRefund: true,
  });
  assert.equal((await h.engine.run("operation")).status, "processing");
  assert.equal(
    h.calls.includes("refund"),
    false,
    "do not refund before the reversal is confirmed",
  );
  assert.equal((await h.engine.run("operation")).status, "processing");
  assert.equal((await h.engine.run("operation")).status, "succeeded");
  assert.equal((await h.engine.run("operation")).status, "succeeded");
  assert.equal(h.calls.filter((call) => call === "reversal").length, 1);
  assert.equal(h.calls.filter((call) => call === "refund").length, 1);
  assert.equal(h.calls.includes("create"), false);
  assert.ok(h.calls.indexOf("reversal") < h.calls.indexOf("refund"));
});
