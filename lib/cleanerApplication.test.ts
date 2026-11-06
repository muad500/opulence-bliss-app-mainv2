import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCleanerApplication,
  cleanerStage2Enabled,
} from "./cleanerApplication";
const fictional = {
  fullName: "TEST Applicant Only",
  email: "test-cleaner@example.invalid",
  phone: "02079460001", // Reserved fictional London number, never contacted.
  postcode: "SW1A 1AA",
  areas: ["TEST area"],
  experience: "TEST fictional cleaning experience",
  availability: "TEST weekday mornings",
  rightToWorkType: "TEST fictional right to work",
  checksAcknowledged: true,
};
test("onboarding test 1: application requires an explicit checks acknowledgment", () => {
  for (const checksAcknowledged of [undefined, false, "true", 1])
    assert.throws(
      () => parseCleanerApplication({ ...fictional, checksAcknowledged }),
      /Privacy Notice/,
    );
});
test("onboarding tests 2/3: normalised application has no password or account role", () => {
  const result = parseCleanerApplication({
    ...fictional,
    email: "TEST-CLEANER@EXAMPLE.INVALID",
    areas: ["TEST area", "TEST area"],
  });
  assert.equal(result.email, "test-cleaner@example.invalid");
  assert.equal(result.postcode, "SW1A1AA");
  assert.equal(result.phone, "+442079460001");
  assert.equal(result.referralCode, null);
  assert.deepEqual(result.areas, ["TEST area"]);
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(Object.hasOwn(result, "role"), false);
  assert.throws(
    () =>
      parseCleanerApplication({ ...fictional, password: "TEST-NOT-ACCEPTED" }),
    /does not create a login/,
  );
});
test("application rejects malformed or oversized input", () => {
  for (const patch of [
    { fullName: "" },
    { email: "bad" },
    { phone: "bad" },
    { postcode: "bad" },
    { areas: [] },
    { areas: [1] },
    { experience: "x".repeat(2001) },
    { availability: "" },
    { rightToWorkType: "" },
  ])
    assert.throws(() => parseCleanerApplication({ ...fictional, ...patch }));
  assert.throws(() => parseCleanerApplication(null));
});
test("stage 2 is off on production and any database except isolated staging", () => {
  const input = {
    VERCEL_ENV: "preview",
    CLEANER_STAGE2_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://comwdjprdedmsnxtvuuk.supabase.co",
  };
  assert.equal(cleanerStage2Enabled(input), true);
  assert.equal(
    cleanerStage2Enabled({ ...input, VERCEL_ENV: "production" }),
    false,
  );
  assert.equal(
    cleanerStage2Enabled({ ...input, CLEANER_STAGE2_ENABLED: "false" }),
    false,
  );
  assert.equal(
    cleanerStage2Enabled({
      ...input,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
    }),
    false,
  );
  assert.equal(cleanerStage2Enabled({}), false);
});
