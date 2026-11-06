import { redirect } from "next/navigation";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { createClient } from "@/lib/supabase/server";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import LegacyProviderSignup from "./LegacyProviderSignup";

export default async function ProviderJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const maintenanceOnly =
    handymanEnabled() && (await searchParams).service === "handyman";
  if (cleanerStage2Enabled() && !maintenanceOnly) {
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) redirect("/cleaner-apply");
    const { data: provider } = await client
      .from("providers")
      .select("id")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!provider) redirect("/cleaner-apply");
    const { data: setup } = await client.rpc("own_cleaner_stage2_setup");
    if (setup?.providerId === provider.id) redirect("/cleaner-setup");
  }
  return <LegacyProviderSignup />;
}
