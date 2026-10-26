import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import Stripe from "stripe";
const require = createRequire(import.meta.url);

function fixture({
  missingAccount = false,
  legacyDestination = false,
  lostCheckpoint = false,
  selfBooking = false,
} = {}) {
  const state = {
    payout: {
      id: "po_fixture",
      status: "not_ready",
      stripe_transfer_ref: null,
    },
    parts: [],
    transfers: [],
    operations: new Map(),
    reviews: [],
    charges: [
      {
        id: "base",
        stripe_payment_intent: "pi_base",
        amount_pence: 5000,
        refunded_pence: 0,
        refunded_lines: {},
        line_items: [
          { id: "cleaning", amountPence: 5000, reservedMinutes: 120 },
        ],
      },
      {
        id: "products",
        stripe_payment_intent: "pi_products",
        amount_pence: 500,
        refunded_pence: 0,
        refunded_lines: {},
        line_items: [{ id: "products", amountPence: 500, reservedMinutes: 0 }],
      },
    ],
  };
  const terms = {
    version: "launch",
    cleanerHourlyPence: 1500,
    productsCleanerPayPence: 400,
    cancellationBasis: "cleaning_hours",
    productsFeePence: 500,
    tipMinimumPence: 300,
    addonPrices: {
      oven: 2000,
      fridge: 1000,
      cupboards: 1000,
      windows: 1500,
      ironing: 1500,
    },
    cancellationRefundPercent: {
      full: 100,
      three_quarter: 75,
      half: 50,
      none: 30,
    },
  };
  const admin = {
    from(table) {
      let update;
      const filters = {};
      const q = {
        select: () => q,
        eq: (key, value) => {
          filters[key] = value;
          return q;
        },
        is: () => q,
        single: () => q,
        maybeSingle: () => q,
        order: () => q,
        update: (value) => {
          update = value;
          return q;
        },
        then(resolve) {
          if (update) {
            if (table === "cleaning_payout_parts") {
              if (lostCheckpoint) {
                lostCheckpoint = false;
                return resolve({
                  data: null,
                  error: { message: "lost database checkpoint" },
                });
              }
              Object.assign(
                state.parts.find(
                  (part) => part.charge_id === filters.charge_id,
                ),
                update,
              );
            } else if (table === "payouts") Object.assign(state.payout, update);
            return resolve({ data: null, error: null });
          }
          const data =
            table === "bookings"
              ? {
                  status: "completed",
                  provider_id: "provider",
                  customer_id: selfBooking ? "professional" : "customer",
                }
              : table === "providers"
                ? {
                    stripe_account_id: missingAccount
                      ? null
                      : "acct_assigned_cleaner",
                    profile_id: "professional",
                  }
                : table === "booking_cleaning_billing_terms"
                  ? { terms }
                  : table === "booking_visit_charges"
                    ? state.charges
                    : table === "payouts"
                      ? state.payout
                      : null;
          resolve({ data: structuredClone(data), error: null });
        },
      };
      return q;
    },
    async rpc(name, input) {
      let data = null;
      if (name === "effective_booking_cleaner_hourly_pence") {
        return { data: terms.cleanerHourlyPence, error: null };
      } else if (name === "prepare_cleaning_payout") {
        if (state.reviews.length)
          return { data: { ready: false, amountPence: 3400 }, error: null };
        if (!state.parts.length)
          state.parts = input.p_parts.map((part) => ({
            charge_id: part.chargeId,
            amount_pence: part.amountPence,
            reversed_pence: 0,
            transfer_ref: null,
            operation_key: `transfer:cleaning:booking:${part.chargeId}:provider:provider:r0`,
          }));
        state.payout.status =
          state.payout.status === "paid" ? "paid" : "processing";
        data = {
          ready: true,
          payoutId: state.payout.id,
          amountPence: 3400,
          parts: structuredClone(state.parts),
        };
      } else if (name === "system_transition_payout")
        state.payout.status = input.p_to_status;
      else if (name === "open_review_case") state.reviews.push(input);
      else if (name === "claim_money_operation") {
        let op = state.operations.get(input.p_operation_key);
        if (!op) {
          op = { id: input.p_operation_key, status: "processing" };
          state.operations.set(input.p_operation_key, op);
          data = { ...op, should_run: true };
        } else data = { ...op, should_run: false };
      } else if (name === "system_finalise_operation") {
        const op = state.operations.get(input.p_operation_id);
        op.status = input.p_outcome;
        op.stripe_object_id = input.p_stripe_id;
      } else throw new Error(`Unexpected RPC ${name}`);
      return { data, error: null };
    },
  };
  const stripe = {
    paymentIntents: {
      retrieve: async (id) => ({
        id,
        status: "succeeded",
        currency: "gbp",
        latest_charge: `ch_${id}`,
        metadata: { booking_id: "booking" },
        transfer_data: legacyDestination
          ? { destination: "acct_test_fallback" }
          : null,
      }),
    },
    charges: {
      retrieve: async (id) => ({
        id,
        amount: id.includes("products") ? 500 : 5000,
        amount_refunded: 0,
        disputed: false,
      }),
    },
    transfers: {
      create: async (params, options) => {
        assert.equal(options.idempotencyKey, params.metadata.operation_key);
        const transfer = { ...params, id: `tr_${state.transfers.length}` };
        state.transfers.push(transfer);
        return structuredClone(transfer);
      },
      retrieve: async (id) =>
        structuredClone(state.transfers.find((transfer) => transfer.id === id)),
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
    vm.runInNewContext(code, {
      module: compiledModule,
      exports: compiledModule.exports,
      process,
      Date,
      console,
      Buffer,
      require: (id) =>
        id === "server-only"
          ? {}
          : id === "stripe"
            ? Stripe
            : id.startsWith("./")
              ? load(`lib/${id.slice(2)}.ts`)
              : require(id),
    });
    cache.set(path, compiledModule.exports);
    return compiledModule.exports;
  }
  return {
    state,
    settle: load("lib/cleaningSettlementServer.ts").createCleaningSettlement(
      admin,
      stripe,
    ).settle,
  };
}
test("cleaning hours and products added later both pay the assigned cleaner exactly once", async () => {
  const h = fixture();
  assert.equal((await h.settle("booking")).payoutSettled, true);
  assert.equal((await h.settle("booking")).payoutSettled, true);
  assert.deepEqual(
    h.state.transfers.map((t) => t.amount),
    [3000, 400],
  );
  assert.ok(
    h.state.transfers.every((t) => t.destination === "acct_assigned_cleaner"),
  );
  assert.deepEqual(
    h.state.transfers.map((t) => t.source_transaction),
    ["ch_pi_base", "ch_pi_products"],
  );
});
test("a lost local transfer checkpoint recovers the succeeded operation without sending twice", async () => {
  const h = fixture({ lostCheckpoint: true });
  await assert.rejects(h.settle("booking"), /checkpoint/);
  assert.equal(h.state.transfers.length, 1);
  assert.equal((await h.settle("booking")).payoutSettled, true);
  assert.equal(h.state.transfers.length, 2);
});
test("missing account, old destination charges and self-bookings are held, never sent to fallback", async () => {
  for (const options of [
    { missingAccount: true },
    { legacyDestination: true },
    { selfBooking: true },
  ]) {
    const h = fixture(options);
    assert.equal((await h.settle("booking")).payoutSettled, false);
    assert.equal(h.state.transfers.length, 0);
    assert.equal(h.state.payout.status, "held");
    assert.equal(h.state.reviews.length, 1);
  }
});
