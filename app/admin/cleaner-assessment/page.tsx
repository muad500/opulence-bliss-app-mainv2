import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/adminSession";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import AssessmentConsole from "./screen";

export const dynamic = "force-dynamic";
export default async function CleanerAssessmentConsolePage() {
  if (!cleanerStage2Enabled()) notFound();
  await requireAdminPage("onboarding");
  return <AssessmentConsole />;
}
