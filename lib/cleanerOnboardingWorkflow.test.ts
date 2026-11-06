import assert from "node:assert/strict";
import test from "node:test";
import {
  CLEANER_APPLICATION_STAGES,
  cleanerStagePlaceholder,
  parseOnboardingAction,
} from "./cleanerOnboardingWorkflow";
const input = {
  applicationId: "00000000-0000-4000-8000-000000000001",
  action: "record",
  stage: "screened",
  note: "TEST fictional note",
  details: {},
};
test("onboarding stages preserve the source order and approved sources need no placeholder", () => {
  assert.deepEqual(
    CLEANER_APPLICATION_STAGES.map((s) => s.key),
    [
      "screened",
      "interviewed",
      "id_rtw_verified",
      "dbs_recorded",
      "experience_checked",
    ],
  );
  assert.equal(cleanerStagePlaceholder("screened"), null);
  assert.equal(cleanerStagePlaceholder("dbs_recorded"), null);
});
test("only explicit stage actions and bounded evidence reach staff RPC", () => {
  assert.equal(parseOnboardingAction(input).stage, "screened");
  for (const patch of [
    { action: "activate" },
    { action: "set_score" },
    { stage: "active" },
    { applicationId: "bad" },
    { note: "" },
    { details: [] },
    { details: { value: "x".repeat(6001) } },
  ])
    assert.throws(() => parseOnboardingAction({ ...input, ...patch }));
});
