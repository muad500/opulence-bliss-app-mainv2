import assert from "node:assert/strict";
import test from "node:test";
import {
  CLEANER_ASSESSMENT_POLICY as policy,
  CLEANER_CORE_QUESTION_IDS as core,
  assessmentAdjustment,
  assessmentDeadline,
  assessmentAnswerInTime,
  assessmentConnectionExpired,
  selectCleanerQuestionIds,
  cleanerPartAOutcome,
  cleanerWritingOutcome,
  canReopenCleanerAssessment,
  cleanerReviewDeadline,
} from "./cleanerAssessmentPolicy";
const start = "2026-11-04T12:00:00.000Z";
test("test 40: question time comes from server timestamps, not a client clock", () => {
  assert.equal(
    assessmentAnswerInTime(start, "2026-11-04T12:00:09.999Z", 1),
    true,
  );
  assert.equal(
    assessmentAnswerInTime(start, "2026-11-04T12:00:10.000Z", 1),
    false,
  );
  assert.equal(
    assessmentAnswerInTime(start, "2026-11-04T11:59:59.000Z", 1),
    false,
  );
});
test("tests 50/53: writing and question adjustments are per applicant", () => {
  for (const multiplier of [1, 2, 3] as const) {
    assert.equal(
      Date.parse(assessmentDeadline(start, "question", multiplier)) -
        Date.parse(start),
      10000 * multiplier,
    );
    assert.equal(
      Date.parse(assessmentDeadline(start, "writing", multiplier)) -
        Date.parse(start),
      300000 * multiplier,
    );
  }
  assert.throws(() => assessmentAdjustment(4));
  assert.throws(() => assessmentAdjustment("2"));
  assert.throws(() => assessmentDeadline("invalid", "writing", 1));
});
test("test 46: short network loss receives exactly the specified grace", () => {
  assert.equal(
    assessmentConnectionExpired(start, "2026-11-04T12:00:03Z"),
    false,
  );
  assert.equal(
    assessmentConnectionExpired(start, "2026-11-04T12:00:05Z"),
    false,
  );
  assert.equal(
    assessmentConnectionExpired(start, "2026-11-04T12:00:05.001Z"),
    true,
  );
  assert.equal(
    assessmentConnectionExpired(start, "2026-11-04T12:00:10Z"),
    true,
  );
});
test("test 43: five core plus ten other questions with no repeats", () => {
  const selections = new Set();
  for (let seed = 1; seed <= 5; seed++) {
    let state = seed;
    const selected = selectCleanerQuestionIds((upper) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % upper;
    });
    assert.equal(selected.length, 15);
    assert.equal(new Set(selected).size, 15);
    assert.ok(core.every((id) => selected.includes(id)));
    assert.ok(selected.every((id) => id >= 1 && id <= 25));
    selections.add(selected.join(","));
  }
  assert.equal(selections.size, 5);
  assert.throws(() => selectCleanerQuestionIds((upper) => upper));
});
test("test 42: twelve passes; eleven does not; no real question bank is imported", () => {
  const marks = (correct: number) =>
    Array.from({ length: 15 }, (_, i) => i < correct);
  assert.equal(cleanerPartAOutcome(marks(12)).phase, "writing");
  assert.equal(cleanerPartAOutcome(marks(11)).phase, "not_progressed");
  assert.throws(() => cleanerPartAOutcome(marks(12).slice(1)));
});
test("optional automatic-fail confirmation is off by default and defers final failure when on", () => {
  assert.equal(policy.staffConfirmAutomaticFail, false);
  assert.equal(
    cleanerPartAOutcome(Array(15).fill(false), true).phase,
    "manager_review",
  );
});
test("tests 51/52: writing not passed always waits for Manager confirmation", () => {
  assert.equal(cleanerWritingOutcome(false), "manager_review");
  assert.equal(cleanerWritingOutcome(true), "acceptances");
});
test("test 55: Manager may reopen once, with a recorded reason", () => {
  const allowed = {
    isManager: true,
    failed: true,
    reopensUsed: 0,
    reason: "TEST technical review",
  };
  assert.equal(canReopenCleanerAssessment(allowed), true);
  for (const denied of [
    { isManager: false },
    { failed: false },
    { reopensUsed: 1 },
    { reopensUsed: -1 },
    { reason: " " },
  ])
    assert.equal(canReopenCleanerAssessment({ ...allowed, ...denied }), false);
});
test("decision review window is fourteen days", () => {
  assert.equal(cleanerReviewDeadline(start), "2026-11-18T12:00:00.000Z");
});
