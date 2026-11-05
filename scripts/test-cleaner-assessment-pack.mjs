import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAssessmentParagraphs,
  assessmentImportSql,
  privateBankHash,
  ASSESSMENT_CORE_IDS,
} from "./cleaner-assessment-pack.mjs";
// Entirely invented. No real question, choice, answer or prompt is a fixture.
export function fictionalAssessmentParagraphs() {
  const lines = [
    "CLEANER ASSESSMENT CONTENT PACK",
    "TEST | Version 1.0 | Effective from: 1 October 2026",
    "Part 2. TEST bank",
  ];
  for (let n = 1; n <= 25; n++)
    lines.push(
      `${n}. ${ASSESSMENT_CORE_IDS.includes(n) ? "[core] " : ""}TEST fictional question ${n}?`,
      "A. TEST first choice  (correct)",
      "B. TEST second choice",
      "C. TEST third choice",
    );
  lines.push("Part 3. TEST writing");
  for (let n = 1; n <= 5; n++)
    lines.push(`${n}. TEST invented writing prompt ${n}`);
  lines.push("Part 4. TEST copy", "TEST supplied copy");
  return lines;
}
test("bank parser keeps exact question/option text and separates private annotations", () => {
  const pack = parseAssessmentParagraphs(fictionalAssessmentParagraphs());
  assert.equal(pack.questions.length, 25);
  assert.equal(pack.writing.length, 5);
  assert.equal(pack.questions[2].prompt, "[core] TEST fictional question 3?");
  assert.equal(pack.questions[0].options[0], "TEST first choice");
  assert.equal(pack.questions[0].correct_option, 1);
  assert.equal(
    JSON.stringify(pack.questions[0].options).includes("(correct)"),
    false,
  );
});
test("malformed, repeated, ambiguous or incorrectly labelled source questions fail closed", () => {
  const base = fictionalAssessmentParagraphs();
  for (const modify of [
    (p) => p.splice(4, 1),
    (p) => {
      p[4] = "A. TEST unmarked choice";
    },
    (p) => {
      p[5] += "  (correct)";
    },
    (p) => {
      p[11] = "3. TEST missing core marker";
    },
    (p) => {
      p[3] = "2. TEST repeated identifier";
    },
    (p) => {
      p[0] = "Wrong document";
    },
  ]) {
    const changed = [...base];
    modify(changed);
    assert.throws(() => parseAssessmentParagraphs(changed));
  }
});
test("private import is staging-guarded and quotes source punctuation safely", () => {
  const paragraphs = fictionalAssessmentParagraphs();
  paragraphs[3] = "1. TEST apostrophe ' and slash \\ and pound £?";
  const pack = parseAssessmentParagraphs(paragraphs);
  const sql = assessmentImportSql(pack, "a".repeat(64));
  assert.match(sql, /opulence_staging_recovery_secret/);
  assert.match(sql, /opulence_production_visit_payments_secret/);
  assert.match(sql, /Finish or resolve active assessments/);
  assert.match(sql, /apostrophe ''/);
  assert.match(privateBankHash(pack), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(sql, /grant .*anon|grant .*authenticated/i);
});
