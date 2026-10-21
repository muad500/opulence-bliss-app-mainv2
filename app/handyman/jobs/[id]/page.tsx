import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { privatePortalClient } from "@/lib/professionalPortal";
import { accessibleQuoteJob } from "@/lib/handymanQuoteServer";
import HandymanJobDetail from "@/components/HandymanJobDetail";
export default async function HandymanJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    redirect("/login?next=" + encodeURIComponent("/handyman/jobs/" + id));
  const { data: p } = await client
    .from("providers")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  const job = await accessibleQuoteJob(
    privatePortalClient(),
    id,
    user.id,
    p?.id ?? null,
  );
  if (!job) notFound();
  return (
    <HandymanJobDetail
      id={id}
      portal={job.customer_id === user.id ? "customer" : "professional"}
    />
  );
}
