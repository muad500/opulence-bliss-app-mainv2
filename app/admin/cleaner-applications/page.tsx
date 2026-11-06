import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/adminSession";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import ApplicationConsole from "./screen";
import { cleanerOnboardingDraftCatalog } from "@/lib/cleanerOnboardingDraftsServer";

export const dynamic = "force-dynamic";
export default async function CleanerApplicationConsole() {
  if (!cleanerStage2Enabled()) notFound();
  await requireAdminPage("onboarding");
  const catalog = cleanerOnboardingDraftCatalog();
  return (
    <ApplicationConsole
      checklists={catalog.checklists}
      wordingLabel={catalog.statusLabel}
    />
  );
}
