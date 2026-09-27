import assert from "node:assert/strict";
import test from "node:test";
import { allocateRegularPayment, regularVisitSlots } from "./regularBooking";
import { londonDate, londonParts } from "./appointmentWindow";
import { bookingPricePence } from "./cleaningBooking";

test("weekly visits keep the same London hour through the autumn clock change", () => {
  const first = londonDate(2026, 10, 19, 9).toISOString();
  const slots = regularVisitSlots(first, "weekly", 120, new Date("2026-10-01"));
  assert.equal(slots.length, 6);
  assert.deepEqual(slots.map((slot) => londonParts(slot).hour), [9, 9, 9, 9, 9, 9]);
  assert.equal(new Date(slots[1]).getTime() - new Date(slots[0]).getTime(), 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
});

test("monthly visits keep the original day where possible", () => {
  const first = londonDate(2027, 1, 31, 10).toISOString();
  const slots = regularVisitSlots(first, "monthly", 120, new Date("2027-01-01"));
  assert.deepEqual(slots.map((slot) => londonParts(slot).day), [31, 28, 31, 30, 31, 30]);
});

test("all six dates must fit in the one-year booking horizon", () => {
  const first = londonDate(2027, 9, 1, 10).toISOString();
  assert.throws(() => regularVisitSlots(first, "monthly", 120, new Date("2026-09-25")), /one year/);
});

test("upfront payment is allocated to six visits exactly", () => {
  const visits = allocateRegularPayment(22681, 4519);
  assert.equal(visits.length, 6);
  assert.equal(visits.reduce((sum, visit) => sum + visit.grossPence, 0), 22681);
  assert.equal(visits.reduce((sum, visit) => sum + visit.platformPence, 0), 4519);
  assert.ok(visits.every((visit) => visit.providerPence > 0));
});

test("two hours at the £18.90 regular rate charges six sessions upfront", () => {
  const perVisit = bookingPricePence({
    price: 37.80,
    duration_minutes: 120,
    service_type: "cleaning",
  }, 120);
  assert.equal(perVisit, 3780);
  const visits = allocateRegularPayment(perVisit * 6, Math.round(perVisit * 6 * 0.2));
  assert.equal(visits.reduce((sum, visit) => sum + visit.grossPence, 0), 22680);
  assert.ok(visits.every((visit) => visit.grossPence === 3780));
});

test("every two weeks keeps the London time across the October clock change", () => {
  // 10:00 London on Monday 12 October 2026 (BST); the clocks go back on 25 October.
  const first = "2026-10-12T09:00:00.000Z";
  const slots = regularVisitSlots(first, "fortnightly", 120, new Date("2026-10-01"), 6);
  assert.equal(slots.length, 6);
  assert.deepEqual(slots.slice(0, 3), [
    "2026-10-12T09:00:00.000Z",
    "2026-10-26T10:00:00.000Z",
    "2026-11-09T10:00:00.000Z",
  ]);
});

test("a regular booking can be six to ten visits", () => {
  const first = "2026-10-12T09:00:00.000Z";
  assert.equal(regularVisitSlots(first, "weekly", 120, new Date("2026-10-01"), 10).length, 10);
  assert.throws(() => regularVisitSlots(first, "weekly", 120, new Date("2026-10-01"), 5), /between 6 and 10/);
  assert.throws(() => regularVisitSlots(first, "weekly", 120, new Date("2026-10-01"), 11), /between 6 and 10/);
});

test("the upfront charge splits across ten visits without losing a penny", () => {
  const visits = allocateRegularPayment(37980, 7596, 10);
  assert.equal(visits.length, 10);
  assert.equal(visits.reduce((sum, visit) => sum + visit.grossPence, 0), 37980);
  assert.equal(visits.reduce((sum, visit) => sum + visit.platformPence, 0), 7596);
  assert.ok(visits.every((visit) => visit.providerPence > 0));
});
