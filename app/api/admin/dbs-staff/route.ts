import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";

export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const [staff, selected, events] = await Promise.all([
    ctx.admin
      .from("profiles")
      .select("id,full_name,email")
      .eq("role", "admin")
      .is("account_deleted_at", null)
      .order("full_name"),
    ctx.client.from("dbs_onboarding_staff").select("profile_id"),
    ctx.client
      .from("dbs_access_events")
      .select("id,actor_id,provider_id,action,created_at")
      .order("id", { ascending: false })
      .limit(30),
  ]);
  if (staff.error || selected.error || events.error)
    return NextResponse.json(
      { error: "Onboarding access could not be loaded." },
      { status: 503 },
    );
  return NextResponse.json(
    {
      staff: staff.data,
      selected: selected.data.map((row) => row.profile_id),
      events: events.data,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  let ids: unknown;
  try {
    ids = (await request.json()).ids;
  } catch {
    /* rejected below */
  }
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
  )
    return NextResponse.json(
      { error: "Choose named staff accounts." },
      { status: 400 },
    );
  const { error } = await ctx.client.rpc("set_dbs_onboarding_staff", {
    p_ids: ids,
  });
  if (error)
    return NextResponse.json(
      { error: "Onboarding access could not be saved." },
      { status: 400 },
    );
  return NextResponse.json({ ok: true });
}
