import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasStaffTotpSession } from "@/lib/staffMfa";
import {
  isStaffRole,
  staffRoleAllows,
  type StaffPermission,
} from "@/lib/staffPermissions";

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

  const scope = await supabase.rpc("current_staff_role");
  if (scope.error || !isStaffRole(scope.data))
    redirect("/staff/login?error=access");
  return { supabase, user, profile, staffRole: scope.data };
}

export async function requireAdminPage(permission: StaffPermission = "manage") {
  const context = await requireStaffIdentity();
  const { data, error } = await context.supabase.auth.getClaims();
  if (error || !hasStaffTotpSession(data?.claims, context.user.factors)) {
    redirect("/staff/mfa");
  }
  if (!staffRoleAllows(context.staffRole, permission)) redirect("/admin");
  return context;
}
