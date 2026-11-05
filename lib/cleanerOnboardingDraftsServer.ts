import "server-only";
import catalog from "@/content/cleaner-onboarding-drafts.json";
import type { CleanerOnboardingDraftCatalog } from "./cleanerOnboardingDraftTypes";

// Full staff copy is intentionally never imported by a client component.
// The only editable source is the versioned JSON. This exposes no approval or
// publishing operation, and the catalog cannot be used as a delivery template.
export function cleanerOnboardingDraftCatalog(): CleanerOnboardingDraftCatalog {
  if (catalog.status !== "draft")
    throw Error("Unsupported onboarding review state.");
  return catalog;
}
