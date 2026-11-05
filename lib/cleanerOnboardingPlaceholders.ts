/** Missing-source register. These are staff-facing placeholders, NOT approved
 * client wording. Keep them central and refuse to send them as applicant email. */
export const CLEANER_ONBOARDING_MISSING_SOURCES = {
  applicationReceived: {
    reference: "Onboarding Process 9.1",
    kind: "email",
    wording: "[Onboarding Process 9.1 – wording to be supplied]",
  },
  applicationRejected: {
    reference: "Onboarding Process 9.3",
    kind: "email",
    wording: "[Onboarding Process 9.3 – wording to be supplied]",
  },
  inductionInvitation: {
    reference:
      "Cleaner Onboarding Process — induction invitation (section not specified in the supplied build spec)",
    kind: "email",
    wording:
      "[Cleaner Onboarding Process – induction invitation wording to be supplied]",
  },
  applicationNotice: {
    reference: "Onboarding Process 3.1A",
    kind: "declaration",
    wording:
      "[Onboarding Process 3.1A – application privacy and checks declaration wording to be supplied]",
  },
  deskScreening: {
    reference: "Cleaner Onboarding Checklist — desk screening",
    kind: "checklist",
    wording:
      "[Cleaner Onboarding Checklist – desk screening items to be supplied]",
  },
  interviewCriteria: {
    reference: "Onboarding Process 3.3",
    kind: "checklist",
    wording:
      "[Onboarding Process 3.3 – interview checklist and scoring criteria to be supplied]",
  },
  liveIdentityCheck: {
    reference: "Onboarding Process 3.7",
    kind: "checklist",
    wording:
      "[Onboarding Process 3.7 – detailed live identity and right-to-work checklist to be supplied]",
  },
  managerEscalation: {
    reference: "Onboarding Process 3.9 and 3.14",
    kind: "checklist",
    wording:
      "[Onboarding Process 3.9 and 3.14 – detailed escalation and decision steps to be supplied]",
  },
  firstJobFollowUp: {
    reference: "Onboarding Process 4.1",
    kind: "checklist",
    wording:
      "[Onboarding Process 4.1 – first-job follow-up checklist to be supplied]",
  },
  fifthJobReview: {
    reference: "Onboarding Process 4.2",
    kind: "checklist",
    wording:
      "[Onboarding Process 4.2 – fifth-booking review checklist to be supplied]",
  },
} as const;

export type MissingOnboardingSource =
  keyof typeof CLEANER_ONBOARDING_MISSING_SOURCES;

export function pendingOnboardingWording(id: MissingOnboardingSource) {
  return CLEANER_ONBOARDING_MISSING_SOURCES[id].wording;
}

/** A placeholder can be previewed by staff, never mistaken for final wording
 * or delivered to an applicant. Supplied templates must be versioned and
 * published through the later staff workflow before dispatch is enabled. */
export function requirePublishedOnboardingWording(input: {
  wording: string;
  version: string;
  published: boolean;
}): string {
  if (
    !input.published ||
    !input.version.trim() ||
    !input.wording.trim() ||
    /\[[^\]]*(?:to be supplied|wording|checklist)[^\]]*\]/i.test(input.wording)
  )
    throw new Error(
      "Onboarding wording is awaiting the client's source document.",
    );
  return input.wording;
}
