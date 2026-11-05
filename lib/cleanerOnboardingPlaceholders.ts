import { CLEANER_ONBOARDING_PENDING_SOURCES } from "./cleanerOnboardingDraftMetadata";

// Compatibility name for existing callers. Only generated labels/references
// are client-safe. Full proposed copy lives in the staff-only catalog.
export const CLEANER_ONBOARDING_MISSING_SOURCES =
  CLEANER_ONBOARDING_PENDING_SOURCES;
export type MissingOnboardingSource =
  keyof typeof CLEANER_ONBOARDING_PENDING_SOURCES;

export function pendingOnboardingWording(id: MissingOnboardingSource) {
  return CLEANER_ONBOARDING_PENDING_SOURCES[id].wording;
}

/** Publishing a flag alone cannot turn a draft into approved communication.
 * Approval must be explicit and merge fields filled before any future sender
 * can use the text. This review change adds no sender/publishing operation. */
export function requirePublishedOnboardingWording(input: {
  wording: string;
  version: string;
  published: boolean;
  approvalStatus?: "draft" | "approved";
}): string {
  if (
    !input.published ||
    input.approvalStatus !== "approved" ||
    !input.version.trim() ||
    !input.wording.trim() ||
    /to be supplied|draft\s*[–-]\s*awaiting client approval|\{\{[^}]+\}\}/i.test(
      input.wording,
    )
  )
    throw new Error("Onboarding wording is awaiting client approval.");
  return input.wording;
}
