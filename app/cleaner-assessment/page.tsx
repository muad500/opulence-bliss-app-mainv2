import { notFound } from "next/navigation";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import CleanerAssessment from "./screen";

export const dynamic = "force-dynamic";
export default function CleanerAssessmentPage() {
  if (!cleanerStage2Enabled()) notFound();
  return <CleanerAssessment />;
}
