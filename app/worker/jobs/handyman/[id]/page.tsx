import { notFound } from "next/navigation";
import HandymanJobDetail from "@/components/HandymanJobDetail";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { professionalPortal } from "@/lib/professionalPortal";

export default async function ProfessionalHandymanJob({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!handymanEnabled()) notFound();
  const { id } = await params;
  const { client, admin, provider } = await professionalPortal();
  const { data: job, error } = await admin
    .from("handyman_jobs")
    .select("id")
    .eq("id", id)
    .eq("provider_id", provider.id)
    .maybeSingle();
  if (error) throw new Error("The job could not be loaded.");
  if (!job) notFound();
  return <HandymanJobDetail id={id} portal="professional" />;
}
