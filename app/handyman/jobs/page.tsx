import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canUseProfessionalTools } from "@/lib/professionalAccess";
export default async function LegacyHandymanJobs() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login?next=/handyman/jobs");
  const [{ data: provider }, { data: preferences }] = await Promise.all([
    client
      .from("providers")
      .select("id,vetting_status,is_suspended,service_approvals")
      .eq("profile_id", user.id)
      .maybeSingle(),
    client
      .from("account_profile_details")
      .select("last_account_mode")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  redirect(
    canUseProfessionalTools(provider) &&
      preferences?.last_account_mode === "professional"
      ? "/worker/jobs?service=handyman"
      : "/account/handyman",
  );
}
