import test from "node:test";
import assert from "node:assert/strict";
import {
  accountRoleDestination,
  roleDocumentPath,
  verificationTypesForRole,
  visibleAccountRoles,
  type AccountRoleRecord,
} from "./accountRoles";
const membership = (
  role: AccountRoleRecord["role"],
  status = "active",
): AccountRoleRecord => ({
  role,
  status,
  pay_source: `${role}-source`,
  reward_route: null,
});
test("P9: a handyman never gets a Partner option, including while marketplace is hidden", () => {
  const roles = [
    membership("customer"),
    membership("cleaner"),
    membership("handyman"),
    membership("partner"),
  ];
  assert.deepEqual(
    visibleAccountRoles(roles, true).map((r) => r.role),
    ["customer", "cleaner", "handyman"],
  );
  assert.deepEqual(
    visibleAccountRoles(roles, false).map((r) => r.role),
    ["customer", "cleaner"],
  );
});
test("P10: cleaner and Partner memberships survive switching without merging pay sources", () => {
  const roles = [
    membership("customer"),
    membership("cleaner"),
    membership("partner"),
  ];
  assert.deepEqual(visibleAccountRoles(roles, false), roles);
  assert.equal(
    accountRoleDestination("cleaner", "active"),
    "/account/roles/cleaner",
  );
  assert.equal(
    accountRoleDestination("partner", "approved"),
    "/account/roles/partner",
  );
  assert.equal(roles[1].pay_source, "cleaner-source");
  assert.equal(roles[2].pay_source, "partner-source");
});
test("H34: role document groups exclude the other trade's evidence", () => {
  assert.equal(
    verificationTypesForRole("cleaner").includes("gas_safe_registration"),
    false,
  );
  assert.equal(
    verificationTypesForRole("handyman").includes("gas_safe_registration"),
    true,
  );
  assert.deepEqual(verificationTypesForRole("partner"), []);
  assert.deepEqual(verificationTypesForRole("customer"), []);
});
test("C10/H37: private professional documents and public privacy use working audience routes", () => {
  assert.equal(
    roleDocumentPath("cleaner", "cleaner-cancellation"),
    "/provider/join/policies/cleaner-cancellation",
  );
  assert.equal(
    roleDocumentPath("handyman", "handyman-professional-terms"),
    "/provider/join/policies/handyman-professional-terms",
  );
  assert.equal(roleDocumentPath("cleaner", "privacy"), "/legal/privacy");
  assert.equal(
    roleDocumentPath("partner", "partner-programme"),
    "/legal/partner-programme",
  );
});
