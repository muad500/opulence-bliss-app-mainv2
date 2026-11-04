import "server-only";
import { createClient as adminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginMutation } from "@/lib/accountApi";
import { hasStaffTotpSession } from "@/lib/staffMfa";
import {
  isStaffRole,
  staffRoleAllows,
  type StaffPermission,
} from "@/lib/staffPermissions";

export async function adminApi(
  request: NextRequest,
  permission: StaffPermission = "manage",
) {
  if (request.method !== "GET" && !isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open this request from the website." },
      { status: 403 },
    );
  const client = await createClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user)
    return NextResponse.json(
      { error: "Please sign in as staff." },
      { status: 401 },
    );
  const { data, error: profileError } = await client
    .from("profiles")
    .select("role,account_deleted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || data?.role !== "admin" || data.account_deleted_at)
    return NextResponse.json(
      { error: "Staff access required." },
      { status: 403 },
    );
  const assurance = await client.auth.getClaims();
  if (
    assurance.error ||
    !hasStaffTotpSession(assurance.data?.claims, user.factors)
  ) {
    return NextResponse.json(
      {
        error: "Complete authenticator sign-in before using staff tools.",
        mfaRequired: true,
        redirectTo: "/staff/mfa",
      },
      { status: 403 },
    );
  }
  const scope = await client.rpc("current_staff_role");
  if (
    scope.error ||
    !isStaffRole(scope.data) ||
    !staffRoleAllows(scope.data, permission)
  )
    return NextResponse.json(
      { error: "Your staff role cannot use this tool." },
      { status: 403 },
    );
  return {
    user,
    client,
    staffRole: scope.data,
    admin: adminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
  };
}
