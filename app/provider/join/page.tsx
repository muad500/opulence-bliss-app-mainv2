import { redirect } from "next/navigation";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { createClient } from "@/lib/supabase/server";
import LegacyProviderSignup from "./LegacyProviderSignup";

export default async function ProviderJoinPage() {
  if (cleanerStage2Enabled()) {
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
