import { notFound, redirect } from "next/navigation";
import { privatePortalClient } from "@/lib/professionalPortal";
import { createClient } from "@/lib/supabase/server";
export default async function LegacyHandymanJob({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { id } = await params;
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    redirect("/login?next=" + encodeURIComponent("/handyman/jobs/" + id));
  const { data: professional } = await client
    .from("providers")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  const { data: job, error } = await privatePortalClient()
    .from("handyman_jobs")
    .select("customer_id,provider_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("The booking could not be loaded.");
  if (
    !job ||
    (job.customer_id !== user.id && job.provider_id !== professional?.id)
  )
    notFound();
  const checkout = (await searchParams).checkout;
  const suffix =
    checkout === "complete" || checkout === "cancelled"
      ? "?checkout=" + checkout
      : "";
  redirect(
    (job.customer_id === user.id
      ? "/account/handyman/"
      : "/worker/jobs/handyman/") +
      id +
      suffix,
  );
}
