import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingTipLine,
  optionalBookingTipPence,
  retainedBookingTipPence,
} from "./bookingTips";

test("booking tip is optional and a selected tip starts at £3", () => {
  assert.equal(optionalBookingTipPence(), 0);
  assert.equal(optionalBookingTipPence(0), 0);
  assert.equal(optionalBookingTipPence(300), 300);
  assert.equal(optionalBookingTipPence(301), 301);
  assert.equal(bookingTipLine(), null);
});
test("reject invalid or coerced booking tip values", () => {
  for (const value of [
    1,
    299,
    -300,
    300.5,
    "300",
    "3",
    null,
    true,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => optionalBookingTipPence(value), /at least £3/);
});
test("tip is a separate item without cleaning time", () => {
  assert.deepEqual(bookingTipLine(500), {
    id: "tip",
    label: "Tip for your cleaner",
    amountPence: 500,
    reservedMinutes: 0,
  });
});
test("the cleaner receives 100% of the remaining funded tip", () => {
  const tip = bookingTipLine(500)!;
  assert.equal(retainedBookingTipPence([tip], {}), 500);
  assert.equal(retainedBookingTipPence([tip], { tip: 200 }), 300);
  assert.equal(retainedBookingTipPence([tip], { tip: 500 }), 0);
  assert.equal(retainedBookingTipPence([], {}), 0);
});
test("duplicate tips or unallocated/excess refunds fail closed", () => {
  const tip = bookingTipLine(500)!;
  assert.throws(() => retainedBookingTipPence([tip, tip], {}), /Duplicate/);
  for (const refunded of [-1, 501, 0.5])
    assert.throws(
      () => retainedBookingTipPence([tip], { tip: refunded }),
      /reconciliation/,
    );
  assert.throws(
    () => retainedBookingTipPence([], { tip: 500 }),
    /reconciliation/,
  );
  assert.throws(
    () => retainedBookingTipPence([{ ...tip, reservedMinutes: 30 }], {}),
    /cleaning time/,
  );
});
