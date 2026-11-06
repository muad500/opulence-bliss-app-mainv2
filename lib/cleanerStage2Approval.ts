import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanerStage2Enabled } from "./cleanerApplication";

/** Called only after the staff/MFA check. Do not expose applicant evidence. */
export async function cleanerStage2ApprovalRequirements(
  admin: SupabaseClient,
  provider: string,
  service: string,
): Promise<string[]> {
  if (service !== "cleaning" || !cleanerStage2Enabled()) return [];
  const result = await admin
    .from("cleaner_applications")
    .select("status")
    .eq("provider_id", provider)
    .maybeSingle();
  if (result.error)
    throw Error("Cleaner account setup requirements could not be loaded.");
  if (result.data && !["accepted_setup", "active"].includes(result.data.status))
    return ["post-assessment account setup and policy acceptances"];
  return [];
}
