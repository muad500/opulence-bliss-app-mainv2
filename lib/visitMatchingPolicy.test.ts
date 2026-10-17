import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchingStage,
  assignedPaymentMustCancel,
} from "./visitMatchingPolicy";

const start = "2026-11-01T10:00:00.000Z";
const before = (hours: number) => Date.parse(start) - hours * 3_600_000;
test("matching notices follow the visit instant, including exact boundaries", () => {
  assert.equal(matchingStage(start, before(336)), "finding");
  assert.equal(matchingStage(start, before(48)), "admin_alert");
  assert.equal(matchingStage(start, before(24)), "customer_warning");
  assert.equal(matchingStage(start, before(2)), "deadline");
});
test("unassigned or never-attempted late visits are not payment failures", () => {
  assert.equal(assignedPaymentMustCancel(start, false, 0, before(12)), false);
  assert.equal(assignedPaymentMustCancel(start, false, 1, before(12)), false);
  assert.equal(assignedPaymentMustCancel(start, true, 0, before(12)), false);
  assert.equal(assignedPaymentMustCancel(start, true, 1, before(24)), true);
  assert.equal(assignedPaymentMustCancel(start, true, 1, before(24.01)), false);
});

test("late acceptance can update its card only until the bounded deadline", () => {
  const grace = new Date(before(10)).toISOString();
  assert.equal(
    assignedPaymentMustCancel(start, true, 1, before(11), grace),
    false,
  );
  assert.equal(
    assignedPaymentMustCancel(start, true, 2, before(10), grace),
    true,
  );
  // A bad or stale deadline can never permit a retry inside three hours.
  assert.equal(
    assignedPaymentMustCancel(start, true, 1, before(2.5), start),
    true,
  );
  assert.equal(
    assignedPaymentMustCancel(start, true, 1, before(3), start),
    true,
  );
});
