import assert from "node:assert/strict";
import test from "node:test";
import { bookingPolicyError, isBookingFrequency } from "./bookingPolicy";

test("checkout finalisation accepts each booking frequency", () => {
  for (const frequency of ["one_time", "weekly", "fortnightly", "monthly"]) {
    assert.equal(isBookingFrequency(frequency), true);
  }
  assert.equal(isBookingFrequency("daily"), false);
});

test("regular rate cannot be checked out for a single visit", () => {
  assert.match(bookingPolicyError("Essential Clean", "one_time") ?? "", /six to ten visits/);
});

test("a stated regular frequency requires the regular package", () => {
  for (const frequency of ["weekly", "fortnightly", "monthly"]) {
    assert.equal(bookingPolicyError("Essential Clean", frequency), null);
    assert.match(bookingPolicyError("One-Time Essential Clean", frequency) ?? "", /Essential Clean/);
  }
});

test("one-time packages remain available for a single visit", () => {
  assert.equal(bookingPolicyError("One-Time Essential Clean", "one_time"), null);
  assert.equal(bookingPolicyError("Signature Deep Clean", "one_time"), null);
});

test("unknown frequencies are rejected", () => {
  assert.match(bookingPolicyError("One-Time Essential Clean", "daily") ?? "", /valid/);
});

test("no policy message reveals a price", () => {
  for (const [name, frequency] of [["Essential Clean", "one_time"], ["One-Time Essential Clean", "weekly"]]) {
    assert.doesNotMatch(bookingPolicyError(name, frequency) ?? "", /£/);
  }
});
