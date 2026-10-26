import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function fixture(tipPence, feePence) {
  const state = { transfers: [], payout: null, operations: new Map() };
  const payment = {
    id: "tip",
    booking_id: "booking",
    kind: "tip",
    status: "succeeded",
    gross_amount: tipPence / 100,
    stripe_payment_ref: "pi_tip",
  };
  const admin = {
    from(table) {
      let update;
      const q = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        or: () => q,
        is: () => q,
        single: () => q,
        maybeSingle: () => q,
        insert: (values) => {
          state.payout = { ...values, id: "payout", stripe_transfer_ref: null };
          return q;
        },
        update: (values) => {
          update = values;
          return q;
        },
        then: (resolve) => {
          if (update) Object.assign(state.payout, update);
          const data =
            table === "payments"
              ? payment
              : table === "bookings"
                ? {
                    id: "booking",
                    provider_id: "professional",
                    status: "completed",
                  }
                : table === "payouts"
                  ? state.payout
                  : table === "providers"
                    ? { stripe_account_id: "acct_assigned" }
                    : null;
          return Promise.resolve({ data, error: null, count: 0 }).then(resolve);
        },
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  class Stripe {
    paymentIntents = {
      retrieve: async () => ({
        status: "succeeded",
        metadata: { kind: "tip", booking_id: "booking" },
        latest_charge: {
          id: "ch_tip",
          balance_transaction: { fee: feePence, net: tipPence - feePence },
        },
        transfer_data: null,
      }),
    };
    transfers = {
      create: async (params, options) => {
        assert.equal(options.idempotencyKey, params.metadata.operation_key);
        state.transfers.push(params);
        return { id: "tr_tip" };
      },
    };
  }
  const bookingState = {
    claimMoneyOperation: async (_admin, input) => {
      let op = state.operations.get(input.operationKey);
      if (op) return { ...op, should_run: false };
      op = { id: input.operationKey, status: "processing", should_run: true };
      state.operations.set(input.operationKey, op);
      return op;
    },
    systemFinaliseMoneyOperation: async (_admin, id, status, details) =>
      Object.assign(state.operations.get(id), {
        status,
        stripe_object_id: details?.stripeObjectId,
      }),
    systemTransitionPayout: async (_admin, _id, status) => {
      state.payout.status = status;
    },
  };
  const vmModule = { exports: {} };
  const compiled = ts.transpileModule(
    readFileSync("lib/tipPayout.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const context = vm.createContext({
    exports: vmModule.exports,
    module: vmModule,
    process: { env: {} },
    console,
    require: (id) =>
      id === "server-only"
        ? {}
        : id === "stripe"
          ? Stripe
          : id === "@supabase/supabase-js"
            ? { createClient: () => admin }
            : id === "@/lib/bookingState"
              ? bookingState
              : id === "@/lib/payoutDestination"
                ? { assignedProviderDestination: () => "acct_assigned" }
                : (() => {
                    throw Error(id);
                  })(),
  });
  new vm.Script(compiled).runInContext(context);
  return { settle: vmModule.exports.settleTipPayout, state };
}
for (const [tip, fee] of [
  [300, 25],
  [1000, 45],
  [999, 73],
])
  test(`cleaner receives full ${tip}p tip despite ${fee}p platform Stripe fee, once`, async () => {
    const h = fixture(tip, fee);
    assert.equal((await h.settle("tip")).payoutSettled, true);
    assert.equal((await h.settle("tip")).payoutSettled, true);
    assert.equal(h.state.transfers.length, 1);
    assert.equal(h.state.transfers[0].amount, tip);
    assert.equal(h.state.transfers[0].destination, "acct_assigned");
    assert.equal(h.state.payout.amount, tip / 100);
  });
