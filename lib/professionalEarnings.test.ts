import assert from "node:assert/strict";
import { test } from "node:test";
import { handymanEarnings, type HandymanEarning } from "./professionalEarnings";

const job: HandymanEarning = {
  id: "job",
  task_name: "Furniture assembly",
  scheduled_at: "2026-10-10T09:00:00Z",
  status: "completed",
  hourly_rate_pence: 3200,
  estimated_minutes: 120,
  vat_bps: 0,
  transfer_ref: "tr_fixture",
  bill: { provider: 6120, gross: 7400 },
};
test("handyman earnings include materials in full and count a settled job once", () => {
  const result = handymanEarnings([job]);
  assert.equal(result.settled, 61.2);
  assert.equal(result.awaitingSettlement, 0);
  assert.equal(result.periods.length, 1);
});
test("unsettled, cancelled and unauthorised jobs are not paid earnings", () => {
  const result = handymanEarnings([
    { ...job, status: "payment_pending", transfer_ref: null },
    { ...job, id: "cancelled", status: "cancelled" },
    { ...job, id: "checkout", status: "checkout_pending" },
  ]);
  assert.equal(result.settled, 0);
  assert.equal(result.awaitingSettlement, 61.2);
  assert.equal(result.rows.length, 1);
});
test("a scheduled job uses a labour estimate, with no invented materials", () => {
  const result = handymanEarnings([
    { ...job, status: "scheduled", transfer_ref: null, bill: null },
  ]);
  assert.equal(result.awaitingSettlement, 51.2);
  assert.match(result.rows[0].label, /estimated/);
});
