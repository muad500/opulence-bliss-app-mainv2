import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireAdminPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) redirect("/staff/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, full_name, account_deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin" || profile.account_deleted_at) {
    redirect("/staff/login?error=access");
  }

  return { supabase, user, profile };
}
