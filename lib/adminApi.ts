import "server-only";
import { createClient as adminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginMutation } from "@/lib/accountApi";

export async function adminApi(request: NextRequest) {
  if (request.method !== "GET" && !isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open this request from the website." },
      { status: 403 },
    );
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Please sign in as staff." },
      { status: 401 },
    );
  const { data } = await client
    .from("profiles")
    .select("role,account_deleted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (data?.role !== "admin" || data.account_deleted_at)
    return NextResponse.json(
      { error: "Staff access required." },
      { status: 403 },
    );
  return {
    user,
    client,
    admin: adminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
  };
}
