import { notFound } from "next/navigation";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import ApplicationForm from "./screen";

export const dynamic = "force-dynamic";
export default function CleanerApplicationPage() {
  if (!cleanerStage2Enabled()) notFound();
  return <ApplicationForm />;
}
