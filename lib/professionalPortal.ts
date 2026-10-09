import "server-only";
import {
  createClient as createAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canUseProfessionalTools } from "@/lib/professionalAccess";
import type { ServiceApprovals } from "@/lib/professionalServices";
import type { HandymanEarning } from "@/lib/professionalEarnings";

export async function professionalPortal() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/provider/login");
  const { data: provider, error } = await client
    .from("providers")
    .select(
      "id,profile_id,display_name,services,service_approvals,vetting_status,is_suspended",
    )
    .eq("profile_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Your professional account could not be loaded.");
  if (!provider) redirect("/provider/join");
  if (!canUseProfessionalTools(provider)) redirect("/worker/application");
  const admin = privatePortalClient();
  return {
    admin,
    client,
    user,
    provider: {
      ...provider,
      service_approvals: provider.service_approvals as ServiceApprovals,
    },
  };
}

export function privatePortalClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export async function allHandymanEarnings(
  client: SupabaseClient,
  providerId: string,
) {
  const rows: HandymanEarning[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("handyman_jobs")
      .select(
        "id,task_name,scheduled_at,status,hourly_rate_pence,estimated_minutes,vat_bps,transfer_ref,bill",
      )
      .eq("provider_id", providerId)
      .order("scheduled_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("Handyman earnings could not be loaded.");
    rows.push(...((data ?? []) as HandymanEarning[]));
    if (!data || data.length < 500) return rows;
  }
}
