import "server-only";
import catalog from "@/content/cleaner-onboarding-drafts.json";
import reviewed from "@/content/history/cleaner-onboarding-draft-1.json";
import type { CleanerOnboardingDraftCatalog } from "./cleanerOnboardingDraftTypes";

// Full staff copy is intentionally never imported by a client component.
// The only editable source is the versioned JSON. This exposes no approval or
// publishing operation. Approved delivery has its own allowlist/outbox gates.
export function cleanerOnboardingDraftCatalog(): CleanerOnboardingDraftCatalog {
  if (!["draft", "approved"].includes(catalog.status))
    throw Error("Unsupported onboarding review state.");
  if (catalog.status === "approved") {
    for (const key of ["emails", "declarations", "checklists"] as const) {
      const content = catalog[key].map(
        ({ approval, statusLabel, ...item }) => item,
      );
      if (JSON.stringify(content) !== JSON.stringify(reviewed[key]))
        throw Error("Onboarding wording differs from the approved review.");
    }
  }
  return catalog;
}
