import assert from "node:assert/strict";
import test from "node:test";
import { isTestStripeKey, payoutDestination } from "./payoutDestination";

test("a live transfer never falls back to the test account", () => {
  assert.equal(payoutDestination(null, { livemode: true, testAccount: "acct_test" }), null);
  assert.equal(payoutDestination("acct_real", { livemode: true, testAccount: "acct_test" }), "acct_real");
});

test("sandbox transfers can use a test account", () => {
  assert.equal(payoutDestination(null, { livemode: false, testAccount: "acct_test" }), "acct_test");
  assert.equal(payoutDestination(null, { livemode: false }), null);
});

test("unknown and live keys are never treated as test keys", () => {
  assert.equal(isTestStripeKey("sk_test_example"), true);
  assert.equal(isTestStripeKey("rk_test_example"), true);
  assert.equal(isTestStripeKey("sk_live_example"), false);
  assert.equal(isTestStripeKey(undefined), false);
});
