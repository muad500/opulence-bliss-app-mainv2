import assert from "node:assert/strict";
import test from "node:test";
import { londonDate } from "./appointmentWindow";
import { cancellationPeriodEnd, startsWithinCancellationPeriod } from "./cancellationPeriod";

// Booked on 1 November 2026 at 10:00, London time.
const booked = londonDate(2026, 11, 1, 10);

test("the period ends at the end of the 14th day after the booking day", () => {
  assert.equal(cancellationPeriodEnd(booked).getTime(), londonDate(2026, 11, 16, 0).getTime());
});

test("a visit on the 14th day after booking is inside the period", () => {
  assert.equal(startsWithinCancellationPeriod(londonDate(2026, 11, 15, 19, 30), booked), true);
});

test("a visit on the 15th day after booking is outside the period", () => {
  assert.equal(startsWithinCancellationPeriod(londonDate(2026, 11, 16, 7), booked), false);
});

test("a same-week visit is inside the period", () => {
  assert.equal(startsWithinCancellationPeriod(londonDate(2026, 11, 3, 9), booked), true);
});

test("the end is London midnight across the October clock change", () => {
  // Booked 20 October (BST); the period ends at midnight GMT on 4 November.
  const october = londonDate(2026, 10, 20, 12);
  assert.equal(cancellationPeriodEnd(october).toISOString(), "2026-11-04T00:00:00.000Z");
});

test("the period rolls over a month end", () => {
  const lateMonth = londonDate(2026, 11, 25, 12);
  assert.equal(cancellationPeriodEnd(lateMonth).getTime(), londonDate(2026, 12, 10, 0).getTime());
});
