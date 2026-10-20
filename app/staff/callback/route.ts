import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Recovery is deliberately separate from customer OAuth/sign-up callbacks. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const failure = () =>
    NextResponse.redirect(new URL("/staff/login?error=recovery", url.origin));
  if (!code) return failure();
  const client = await createClient();
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return failure();
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) return failure();
  const profile = await client
    .from("profiles")
    .select("role,account_deleted_at")
    .eq("id", data.user.id)
    .maybeSingle();
  if (
    profile.error ||
    profile.data?.role !== "admin" ||
    profile.data.account_deleted_at
  ) {
    await client.auth.signOut({ scope: "local" });
    return failure();
  }
  // Never honour a caller-supplied destination or bypass the authenticator.
  return NextResponse.redirect(new URL("/staff/update-password", url.origin));
}
