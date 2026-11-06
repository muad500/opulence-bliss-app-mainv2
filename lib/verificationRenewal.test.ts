import { test } from "node:test";
import assert from "node:assert/strict";
import { dbsRecheckDate, renewalState } from "./verificationRenewal";
test("DBS renewal uses three calendar years, including leap day", () => {
  assert.equal(dbsRecheckDate("2025-10-03"), "2028-10-03");
  assert.equal(dbsRecheckDate("2024-02-29"), "2027-02-28");
  assert.equal(dbsRecheckDate("2025-02-29"), null);
});
test("renewal warnings start thirty days before and pause after expiry", () => {
  assert.equal(renewalState("2026-11-03", "2026-10-03"), "current");
  assert.equal(renewalState("2026-11-02", "2026-10-03"), "due_soon");
  assert.equal(renewalState("2026-10-03", "2026-10-03"), "due_soon");
  assert.equal(renewalState("2026-10-02", "2026-10-03"), "expired");
  assert.equal(renewalState(null, "2026-10-03"), "missing");
});
