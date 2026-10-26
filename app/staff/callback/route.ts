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

/** Invitation links are redeemed only after an intentional same-origin POST. */
export async function POST(request: NextRequest) {
  const failure = () =>
    NextResponse.redirect(
      new URL("/staff/login?error=recovery", request.url),
      303,
    );
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return failure();
  const form = await request.formData().catch(() => null);
  const token = form?.get("token_hash");
  if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{32,512}$/.test(token))
    return failure();
  const client = await createClient();
  const result = await client.auth.verifyOtp({
    type: "invite",
    token_hash: token,
  });
  if (result.error || !result.data.user) return failure();
  const profile = await client
    .from("profiles")
    .select("role,account_deleted_at")
    .eq("id", result.data.user.id)
    .maybeSingle();
  if (
    profile.error ||
    profile.data?.role !== "admin" ||
    profile.data.account_deleted_at ||
    typeof result.data.user.app_metadata.staff_invited_by !== "string"
  ) {
    await client.auth.signOut({ scope: "local" });
    return failure();
  }
  return NextResponse.redirect(
    new URL("/staff/update-password", request.url),
    303,
  );
}
