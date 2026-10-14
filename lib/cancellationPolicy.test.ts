import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCancellationPolicy,
  cancellationPaymentAction,
} from "./cancellationPolicy";

const NOW = "2026-09-08T12:00:00.000Z";

function hoursFromNow(hours: number) {
  return new Date(new Date(NOW).getTime() + hours * 60 * 60 * 1000);
}

test("more than 48 hours receives a full refund", () => {
  for (const hours of [48, 48.001, 72]) {
    const policy = calculateCancellationPolicy(hoursFromNow(hours), 93.15, NOW);
    assert.equal(policy.tier, "full");
    assert.equal(policy.refundPercent, 100);
    assert.equal(policy.refundAmount, 93.15);
    assert.equal(policy.cancellationCharge, 0);
  }
});

test("24 through 48 hours receives a 75% refund", () => {
  for (const hours of [24, 36, 47.999]) {
    const policy = calculateCancellationPolicy(hoursFromNow(hours), 93.15, NOW);
    assert.equal(policy.tier, "three_quarter");
    assert.equal(policy.refundPercent, 75);
    assert.equal(policy.refundAmount, 69.86);
    assert.equal(policy.cancellationCharge, 23.29);
  }
});

test("less than 24 hours but not the same day receives a 50% refund", () => {
  for (const hours of [12, 23.999]) {
    const policy = calculateCancellationPolicy(hoursFromNow(hours), 93.15, NOW);
    assert.equal(policy.tier, "half");
    assert.equal(policy.refundPercent, 50);
    assert.equal(policy.refundAmount, 46.58);
    assert.equal(policy.cancellationCharge, 46.57);
  }
});

test("same-day or missed bookings receive no automatic refund", () => {
  for (const hours of [1, 0, -1]) {
    const policy = calculateCancellationPolicy(hoursFromNow(hours), 93.15, NOW);
    assert.equal(policy.tier, "none");
    assert.equal(policy.refundPercent, 0);
    assert.equal(policy.refundAmount, 0);
    assert.equal(policy.cancellationCharge, 93.15);
  }
});

test("refund and cancellation charge always reconcile to the penny", () => {
  for (const amount of [0, 0.01, 10.35, 59.4, 93.15]) {
    const policy = calculateCancellationPolicy(hoursFromNow(30), amount, NOW);
    assert.equal(
      policy.refundPence + policy.cancellationChargePence,
      Math.round(amount * 100),
    );
  }
});

test("held and captured payments choose the correct Stripe adjustment", () => {
  const full = calculateCancellationPolicy(hoursFromNow(48.001), 100, NOW);
  const threeQuarter = calculateCancellationPolicy(hoursFromNow(24), 100, NOW);
  const half = calculateCancellationPolicy(hoursFromNow(12), 100, NOW);
  const none = calculateCancellationPolicy(hoursFromNow(1), 100, NOW);

  assert.equal(cancellationPaymentAction("authorised", full), "release");
  assert.equal(cancellationPaymentAction("authorised", threeQuarter), "capture");
  assert.equal(cancellationPaymentAction("authorised", half), "capture");
  assert.equal(cancellationPaymentAction("authorised", none), "capture");
  assert.equal(cancellationPaymentAction("succeeded", full), "refund");
  assert.equal(cancellationPaymentAction("succeeded", threeQuarter), "refund");
  assert.equal(cancellationPaymentAction("succeeded", half), "refund");
  assert.equal(cancellationPaymentAction("succeeded", none), "none");
  assert.equal(cancellationPaymentAction("created", half), "none");
});
