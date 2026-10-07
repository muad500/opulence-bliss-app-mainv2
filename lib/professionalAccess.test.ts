import assert from "node:assert/strict";
import test from "node:test";
import { canUseProfessionalTools, professionalStatusLabel } from "./professionalAccess";

test("professional tools require explicit approval and an unsuspended account", () => {
  for (const provider of [null, undefined, {}, { vetting_status: "pending", is_suspended: false }, { vetting_status: "rejected", is_suspended: false }, { vetting_status: "approved", is_suspended: true }, { vetting_status: "approved" }]) {
    assert.equal(canUseProfessionalTools(provider), false);
  }
  assert.equal(canUseProfessionalTools({ vetting_status: "approved", is_suspended: false }), true);
});

test("application labels distinguish pending, rejected and suspended accounts", () => {
  assert.equal(professionalStatusLabel(null), "Not applied");
  assert.equal(professionalStatusLabel({ vetting_status: "pending" }), "Application under review");
  assert.equal(professionalStatusLabel({ vetting_status: "rejected" }), "Application not approved");
  assert.equal(professionalStatusLabel({ vetting_status: "approved", is_suspended: true }), "Suspended");
  assert.equal(professionalStatusLabel({ vetting_status: "unknown" }), "Application needs attention");
});
