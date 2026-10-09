import { notFound, redirect } from "next/navigation";
import HandymanJobDetail from "@/components/HandymanJobDetail";
import { privatePortalClient } from "@/lib/professionalPortal";
import { createClient } from "@/lib/supabase/server";
import { handymanEnabled } from "@/lib/handymanMarketplace";

export default async function CustomerHandymanJob({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!handymanEnabled()) notFound();
  const { id } = await params;
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    redirect(`/login?next=${encodeURIComponent(`/account/handyman/${id}`)}`);
  const { data: job, error } = await privatePortalClient()
    .from("handyman_jobs")
    .select("id")
    .eq("id", id)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (error) throw new Error("The booking could not be loaded.");
  if (!job) notFound();
  return <HandymanJobDetail id={id} portal="customer" />;
}
