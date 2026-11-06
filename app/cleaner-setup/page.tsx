import { notFound, redirect } from "next/navigation";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { createClient } from "@/lib/supabase/server";
import Setup from "./screen";
export const dynamic = "force-dynamic";
export default async function CleanerSetupPage() {
  if (!cleanerStage2Enabled()) notFound();
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login?next=/cleaner-setup");
  const state = await client.rpc("own_cleaner_stage2_setup");
  if (state.error || !state.data) notFound();
  return <Setup />;
}
