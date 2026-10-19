import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasStaffTotpSession } from "@/lib/staffMfa";

/** Identity only: used by the MFA setup page, never by an admin operation. */
export async function requireStaffIdentity() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

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

export async function requireAdminPage() {
  const context = await requireStaffIdentity();
  const { data, error } = await context.supabase.auth.getClaims();
  if (error || !hasStaffTotpSession(data?.claims, context.user.factors)) {
    redirect("/staff/mfa");
  }
  return context;
}
