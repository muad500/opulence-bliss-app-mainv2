import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanerPayPence,
  DEFAULT_CLEANING_BILLING_TERMS as defaults,
  parseCleaningBillingTerms,
  customerBillingTerms,
} from "./cleaningBillingTerms";
import { cleaningQuote } from "./cleaningExtras";
import { calculateCancellationPolicy } from "./cancellationPolicy";

test("cleaner pay uses booked cleaning hours, excluding reserved add-on time", () => {
  const quote = cleaningQuote(
    { price: 45.98, duration_minutes: 120, service_type: "cleaning" },
    120,
    ["oven"],
    true,
    1,
    defaults,
  );
  assert.equal(quote.totalPence, 7098);
  assert.equal(quote.durationMinutes, 180);
  assert.equal(cleanerPayPence(quote.baseMinutes, defaults), 3000);
  assert.equal(
    quote.totalPence - cleanerPayPence(quote.baseMinutes, defaults),
    4098,
  );
  assert.equal(cleanerPayPence(150, defaults), 3750);
  assert.equal(cleanerPayPence(480, defaults), 12000);
});

test("saved terms keep old prices, pay, tips and refund bands after a settings edit", () => {
  const before = parseCleaningBillingTerms(structuredClone(defaults));
  const after = parseCleaningBillingTerms({
    ...defaults,
    version: "2",
    cleanerHourlyPence: 1600,
    productsFeePence: 600,
    addonPrices: { ...defaults.addonPrices, oven: 2500 },
    cancellationRefundPercent: {
      full: 100,
      three_quarter: 80,
      half: 60,
      none: 0,
    },
  });
  const pkg = { price: 45.98, duration_minutes: 120, service_type: "cleaning" };
  assert.equal(
    cleaningQuote(pkg, 120, ["oven"], true, 1, before).totalPence,
    7098,
  );
  assert.equal(
    cleaningQuote(pkg, 120, ["oven"], true, 1, after).totalPence,
    7698,
  );
  const now = "2026-10-18T08:00:00Z",
    start = "2026-10-19T14:00:00Z";
  assert.equal(
    calculateCancellationPolicy(
      start,
      100,
      now,
      before.cancellationRefundPercent,
    ).refundPence,
    7500,
  );
  assert.equal(
    calculateCancellationPolicy(
      start,
      100,
      now,
      after.cancellationRefundPercent,
    ).refundPence,
    8000,
  );
  assert.equal(cleanerPayPence(120, before), 3000);
  assert.equal(cleanerPayPence(120, after), 3200);
  assert.equal("cleanerHourlyPence" in customerBillingTerms(after), false);
});

test("reject malformed money, incomplete catalogues and inverted refund bands", () => {
  for (const patch of [
    { cleanerHourlyPence: -1 },
    { tipMinimumPence: 2.5 },
    { productsFeePence: 10001 },
    { addonPrices: { oven: 2000 } },
    {
      cancellationRefundPercent: {
        full: 50,
        three_quarter: 75,
        half: 0,
        none: 0,
      },
    },
  ])
    assert.throws(() => parseCleaningBillingTerms({ ...defaults, ...patch }));
});
