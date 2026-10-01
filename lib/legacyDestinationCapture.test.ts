import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  assertSafeToCaptureBookingPayment,
  captureBookingPayment,
  hasLegacyDestinationCharge,
  LegacyDestinationCaptureError,
} from "./legacyDestinationCapture";

const intent = (destination?: string) => ({
  transfer_data: destination ? { destination } : null,
}) as Pick<Stripe.PaymentIntent, "transfer_data">;

test("new separate-charge PaymentIntents are safe to capture", async () => {
  assert.equal(hasLegacyDestinationCharge(intent()), false);
  const stripe = {
    paymentIntents: { retrieve: async () => intent() },
  } as unknown as Stripe;
  await assert.doesNotReject(assertSafeToCaptureBookingPayment(stripe, "pi_new"));
});

test("old destination-charge PaymentIntents are blocked before capture", async () => {
  assert.equal(hasLegacyDestinationCharge(intent("acct_old")), true);
  const stripe = {
    paymentIntents: { retrieve: async () => intent("acct_old") },
  } as unknown as Stripe;
  await assert.rejects(
    assertSafeToCaptureBookingPayment(stripe, "pi_old"),
    LegacyDestinationCaptureError,
  );
});

test("Stripe retrieval failure never authorises a capture", async () => {
  const stripe = {
    paymentIntents: { retrieve: async () => { throw new Error("Stripe unavailable"); } },
  } as unknown as Stripe;
  await assert.rejects(
    assertSafeToCaptureBookingPayment(stripe, "pi_unknown"),
    /Stripe unavailable/,
  );
});

test("the guarded capture sends new payments to Stripe once", async () => {
  let captures = 0;
  const stripe = {
    paymentIntents: {
      retrieve: async () => intent(),
      capture: async () => { captures += 1; return { id: "pi_new" }; },
    },
  } as unknown as Stripe;
  const result = await captureBookingPayment(stripe, "pi_new", {}, { idempotencyKey: "capture:booking:test" });
  assert.equal(result.id, "pi_new");
  assert.equal(captures, 1);
});

test("the guarded capture never calls Stripe capture for old destination charges", async () => {
  let captures = 0;
  const stripe = {
    paymentIntents: {
      retrieve: async () => intent("acct_old"),
      capture: async () => { captures += 1; return { id: "pi_old" }; },
    },
  } as unknown as Stripe;
  await assert.rejects(
    captureBookingPayment(stripe, "pi_old", {}, { idempotencyKey: "capture:booking:test" }),
    LegacyDestinationCaptureError,
  );
  assert.equal(captures, 0);
});

test("the guarded capture also stops when the pre-capture lookup fails", async () => {
  let captures = 0;
  const stripe = {
    paymentIntents: {
      retrieve: async () => { throw new Error("Stripe unavailable"); },
      capture: async () => { captures += 1; return { id: "pi_unknown" }; },
    },
  } as unknown as Stripe;
  await assert.rejects(
    captureBookingPayment(stripe, "pi_unknown", {}, { idempotencyKey: "capture:booking:test" }),
    /Stripe unavailable/,
  );
  assert.equal(captures, 0);
});
