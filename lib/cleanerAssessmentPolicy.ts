// Assessment rules only: deliberately contains no question text or answer key.
// Authorisation, immutable scoring and the trusted clock belong to the server
// transaction; this module is not an applicant-supplied decision interface.
export const CLEANER_ASSESSMENT_POLICY = Object.freeze({
  version: "1.0",
  questionCount: 15,
  bankSize: 25,
  randomQuestionCount: 10,
  passScore: 12,
  secondsPerQuestion: 10,
  writingSeconds: 300,
  connectionGraceSeconds: 5,
  maxReopens: 1,
  decisionReviewDays: 14,
  staffConfirmAutomaticFail: false,
});
export const CLEANER_CORE_QUESTION_IDS = Object.freeze([3, 6, 7, 8, 10]);
export type AssessmentAdjustment = 1 | 2 | 3;
export type AssessmentFailureReason =
  | "wrong answers"
  | "page left"
  | "connection lost"
  | "timer"
  | "writing not passed";

function timestamp(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    throw Error("Valid server assessment time required.");
  return time;
}
export function assessmentAdjustment(value: unknown): AssessmentAdjustment {
  if (value !== 1 && value !== 2 && value !== 3)
    throw Error("Choose standard, double or triple time.");
  return value;
}
export function assessmentDeadline(
  startedAt: string,
  part: "question" | "writing",
  adjustment: AssessmentAdjustment,
): string {
  const multiplier = assessmentAdjustment(adjustment);
  const seconds =
    part === "question"
      ? CLEANER_ASSESSMENT_POLICY.secondsPerQuestion
      : CLEANER_ASSESSMENT_POLICY.writingSeconds;
  return new Date(
    timestamp(startedAt) + seconds * multiplier * 1000,
  ).toISOString();
}
export function assessmentAnswerInTime(
  startedAt: string,
  receivedAt: string,
  adjustment: AssessmentAdjustment,
): boolean {
  return (
    timestamp(receivedAt) >= timestamp(startedAt) &&
    timestamp(receivedAt) <
      timestamp(assessmentDeadline(startedAt, "question", adjustment))
  );
}
export function assessmentConnectionExpired(
  lastSeenAt: string,
  now: string,
): boolean {
  return (
    timestamp(now) - timestamp(lastSeenAt) >
    CLEANER_ASSESSMENT_POLICY.connectionGraceSeconds * 1000
  );
}
/** The caller supplies cryptographically secure random integers on the server.
 * Tests inject a fictional random source, never the real question/answer bank. */
export function selectCleanerQuestionIds(
  randomInt: (upperBound: number) => number,
): number[] {
  const shuffle = (values: number[]) => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      if (!Number.isInteger(j) || j < 0 || j > i)
        throw Error("Invalid secure random source.");
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  const nonCore = Array.from(
    { length: CLEANER_ASSESSMENT_POLICY.bankSize },
    (_, i) => i + 1,
  ).filter(
    (id) => !(CLEANER_CORE_QUESTION_IDS as readonly number[]).includes(id),
  );
  return shuffle([
    ...CLEANER_CORE_QUESTION_IDS,
    ...shuffle(nonCore).slice(0, CLEANER_ASSESSMENT_POLICY.randomQuestionCount),
  ]);
}
export function cleanerPartAOutcome(
  serverMarkedResults: readonly boolean[],
  staffConfirmAutomaticFail = false,
) {
  if (
    serverMarkedResults.length !== CLEANER_ASSESSMENT_POLICY.questionCount ||
    serverMarkedResults.some((v) => typeof v !== "boolean")
  )
    throw Error("All fifteen questions must be marked on the server.");
  const score = serverMarkedResults.filter(Boolean).length;
  return {
    score,
    phase:
      score >= CLEANER_ASSESSMENT_POLICY.passScore
        ? "writing"
        : staffConfirmAutomaticFail
          ? "manager_review"
          : "not_progressed",
  } as const;
}
export function cleanerWritingOutcome(
  passed: boolean,
): "acceptances" | "manager_review" {
  return passed ? "acceptances" : "manager_review";
}
export function canReopenCleanerAssessment(input: {
  isManager: boolean;
  reason: string;
  reopensUsed: number;
  failed: boolean;
}): boolean {
  return (
    input.isManager &&
    input.failed &&
    input.reason.trim().length > 0 &&
    input.reopensUsed === 0
  );
}
export function cleanerReviewDeadline(decidedAt: string): string {
  return new Date(
    timestamp(decidedAt) +
      CLEANER_ASSESSMENT_POLICY.decisionReviewDays * 86_400_000,
  ).toISOString();
}

// Exact non-secret screen/email copy from the supplied Content Pack v1.0.
export const CLEANER_ASSESSMENT_COPY = Object.freeze({
  rules: [
    "You must stay on this page until you finish. If you leave the page (open another app or tab, lock the screen, reload, go back or close it), you are signed out and the assessment ends as not passed.",
    "Part A has 15 questions. Each question has 10 seconds. You cannot go back.",
    "Part B is a short piece of writing. You have 5 minutes. Please use your own words and do not copy and paste.",
    "The questions are marked automatically. A person marks the writing. A person will review the decision if you ask.",
  ],
  rulesCheckbox: "I have read and understood these rules",
  notPassed:
    "Sorry, you failed the assessment. We won't be going forward this time.",
  review:
    "Your answers were marked automatically. If you think there was a mistake or a technical problem, you can ask a person to review the decision by emailing hello@opulencebliss.com within 14 days. You are welcome to apply again after 3 months. We will delete the information from your application 6 months after our decision.",
  failedEmailSubject: "Your assessment with Opulence Bliss",
  waiting:
    "Thank you. Your writing is being checked. Please stay in the session.",
  passed:
    "Well done. You have passed the assessment. Please continue to accept our terms and policies and set up your account.",
  writingInstruction:
    "Write 4 to 6 sentences in your own words. You have 5 minutes.",
});
