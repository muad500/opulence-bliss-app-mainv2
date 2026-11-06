import { notFound } from "next/navigation";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import Decision from "./screen";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your application decision | Opulence Bliss",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function DecisionPage() {
  if (!cleanerStage2Enabled()) notFound();
  return <Decision />;
}
