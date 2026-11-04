import test from "node:test";
import assert from "node:assert/strict";
import {
  isStaffRole,
  staffRoleAllows,
  type StaffPermission,
} from "./staffPermissions";
const permissions: StaffPermission[] = [
  "manage",
  "onboarding",
  "first_review",
  "second_signoff",
  "suspend",
  "private_evidence",
];
test("onboarding member can review checks and suspend, but cannot manage or second-sign", () => {
  assert.deepEqual(
    permissions.filter((p) => staffRoleAllows("onboarding", p)),
    ["onboarding", "first_review", "suspend", "private_evidence"],
  );
});
test("second sign-off is distinct from onboarding and general management", () => {
  assert.deepEqual(
    permissions.filter((p) => staffRoleAllows("second_signoff", p)),
    ["onboarding", "second_signoff"],
  );
});
test("developer has no live evidence or operational staff permissions", () => {
  assert.deepEqual(
    permissions.filter((p) => staffRoleAllows("developer", p)),
    [],
  );
  assert.equal(isStaffRole("admin-from-user-metadata"), false);
});
test("Manager capabilities include appeals and decisions through management, without removing independent sign-off", () => {
  assert.deepEqual(
    permissions.filter((p) => staffRoleAllows("manager", p)),
    permissions,
  );
});
