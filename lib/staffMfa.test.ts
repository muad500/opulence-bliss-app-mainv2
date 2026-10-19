import test from "node:test";
import assert from "node:assert/strict";
import { hasStaffTotpSession } from "./staffMfa";
test("staff requires signed AAL2, a TOTP AMR and a currently verified TOTP factor", () => {
  const claims = {
    aal: "aal2",
    amr: [{ method: "password" }, { method: "totp" }],
  };
  const factors = [{ factor_type: "totp", status: "verified" }];
  assert.equal(hasStaffTotpSession(claims, factors), true);
  for (const wrong of [
    null,
    {},
    { aal: "aal1", amr: claims.amr },
    { aal: "aal2", amr: [] },
    { aal: "aal2", amr: [{ method: "phone" }] },
  ])
    assert.equal(hasStaffTotpSession(wrong, factors), false);
  for (const wrong of [
    null,
    [],
    [{ factor_type: "totp", status: "unverified" }],
    [{ factor_type: "phone", status: "verified" }],
  ])
    assert.equal(hasStaffTotpSession(claims, wrong), false);
});
