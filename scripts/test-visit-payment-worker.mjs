import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const module = { exports: {} };
const code = ts.transpileModule(
  readFileSync("supabase/functions/visit-payments/handler.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
vm.runInNewContext(code, {
  module,
  exports: module.exports,
  require: (id) =>
    id.endsWith("lib/visitBillingServer")
      ? {
          createVisitBilling() {
            throw new Error("Unexpected default worker dependency");
          },
        }
      : require(id),
  Deno: { env: { get() {} }, serve() {} },
  TextEncoder,
  Request,
  Response,
  __VISIT_WORKER_SOURCE_SHA__: "fixture-source-hash",
  console: { error() {} },
});
const { createVisitPaymentHandler } = module.exports;
const cron = "disposable-local-worker-test-secret-000000";
function harness(changes = {}, account = "acct_1UKQ4A2NzINBHbzj", fail = null) {
  const env = {
    VISIT_PAYMENTS_CRON_SECRET: cron,
    VISIT_PAYMENTS_MODE: "staging",
    VISIT_PAYMENTS_ENABLED: "true",
    SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role",
    VISIT_PAYMENTS_STRIPE_SECRET_KEY: "sk_test_fixture",
    ...changes,
  };
  const calls = { stripe: 0, admin: 0, tick: 0 };
  const handler = createVisitPaymentHandler({
    env: (name) => env[name],
    stripe: () => {
      calls.stripe++;
      return {
        accounts: {
          async retrieveCurrent() {
            if (fail === "stripe")
              throw new Error("Provider details must never be exposed");
            return { id: account };
          },
        },
      };
    },
    admin: () => {
      calls.admin++;
      return {};
    },
    tick: async () => {
      calls.tick++;
      if (fail === "tick") throw new Error("Private database failure");
      return { due: 1 };
    },
  });
  return {
    calls,
    run: (token = cron, method = "POST") =>
      handler(
        new Request("https://staging.invalid/visit-payments", {
          method,
          headers: { "x-visit-payments-secret": token },
        }),
      ),
  };
}

test("an unauthenticated or incorrectly authenticated request cannot reach billing", async () => {
  for (const token of ["", "wrong", "x".repeat(cron.length)]) {
    const h = harness();
    assert.equal((await h.run(token)).status, 401);
    assert.equal(h.calls.stripe, 0);
    assert.equal(h.calls.admin, 0);
    assert.equal(h.calls.tick, 0);
  }
  const weak = harness({ VISIT_PAYMENTS_CRON_SECRET: "short" });
  assert.equal((await weak.run("short")).status, 401);
});
test("only POST may invoke the worker", async () => {
  const h = harness();
  assert.equal((await h.run(cron, "GET")).status, 405);
  assert.equal(h.calls.tick, 0);
});
test("disabled, incomplete or mixed-environment configuration fails before financial APIs", async () => {
  for (const change of [
    { VISIT_PAYMENTS_ENABLED: "false" },
    { VISIT_PAYMENTS_MODE: "unknown" },
    { SUPABASE_URL: "https://uiqcsihgqaktpjumyeap.supabase.co" },
    { VISIT_PAYMENTS_STRIPE_SECRET_KEY: "sk_live_fixture" },
    { SUPABASE_SERVICE_ROLE_KEY: "" },
  ]) {
    const h = harness(change);
    assert.equal((await h.run()).status, 503);
    assert.equal(h.calls.stripe, 0);
    assert.equal(h.calls.tick, 0);
  }
});
test("a different Stripe account cannot process payments even with a matching key prefix", async () => {
  const h = harness({}, "acct_wrong");
  assert.equal((await h.run()).status, 503);
  assert.equal(h.calls.admin, 0);
  assert.equal(h.calls.tick, 0);
});
test("the staging worker runs once and reports its deployed source hash", async () => {
  const h = harness();
  const response = await h.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "staging");
  assert.equal(body.source, "fixture-source-hash");
  assert.equal(h.calls.tick, 1);
});
test("production requires its own database, live key and account", async () => {
  const changes = {
    VISIT_PAYMENTS_MODE: "production",
    SUPABASE_URL: "https://uiqcsihgqaktpjumyeap.supabase.co",
    VISIT_PAYMENTS_STRIPE_SECRET_KEY: "sk_live_fixture",
  };
  const correct = harness(changes, "acct_1UL6n3ILnegr7Mwu");
  assert.equal((await correct.run()).status, 200);
  const testKey = harness(
    { ...changes, VISIT_PAYMENTS_STRIPE_SECRET_KEY: "sk_test_fixture" },
    "acct_1UL6n3ILnegr7Mwu",
  );
  assert.equal((await testKey.run()).status, 503);
  assert.equal(testKey.calls.tick, 0);
});
test("provider or database failures return a failure without exposing private details", async () => {
  for (const failure of ["stripe", "tick"]) {
    const h = harness({}, "acct_1UKQ4A2NzINBHbzj", failure);
    const response = await h.run();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Visit scheduler will retry",
    });
  }
});
