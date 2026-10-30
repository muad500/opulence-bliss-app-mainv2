import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginMutation, readAccountBody } from "@/lib/accountApi";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id))
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { data, error } = await client
    .from("cleaning_time_changes")
    .select("id,original_at,proposed_at,requested_by,status")
    .eq("booking_id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: "Time changes are unavailable" },
      { status: 503 },
    );
  return NextResponse.json(
    {
      request: data
        ? { ...data, canRespond: data.requested_by !== user.id }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: NextRequest, context: Context) {
  if (!isSameOriginMutation(request))
    return NextResponse.json({ error: "Use the website" }, { status: 403 });
  const { id } = await context.params;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (!uuid.test(id) || body.confirm !== true)
    return NextResponse.json(
      { error: "Confirm the time change" },
      { status: 400 },
    );
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let result;
  if (
    body.action === "propose" &&
    typeof body.slot === "string" &&
    Number.isFinite(Date.parse(body.slot))
  )
    result = await client.rpc("request_cleaning_time_change", {
      p_booking: id,
      p_slot: body.slot,
    });
  else if (
    body.action === "respond" &&
    typeof body.changeId === "string" &&
    uuid.test(body.changeId) &&
    typeof body.accept === "boolean"
  ) {
    const allowed = await client
      .from("cleaning_time_changes")
      .select("id")
      .eq("id", body.changeId)
      .eq("booking_id", id)
      .maybeSingle();
    if (allowed.error || !allowed.data)
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    result = await client.rpc("respond_cleaning_time_change", {
      p_change: body.changeId,
      p_accept: body.accept,
    });
  } else
    return NextResponse.json(
      { error: "Choose a time or response" },
      { status: 400 },
    );
  if (result.error)
    return NextResponse.json({ error: result.error.message }, { status: 409 });
  return NextResponse.json({ ok: true });
}
