import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await accountContext(req);
  if (isAccountError(ctx)) return ctx;
  const { id } = await params;
  const { data: booking } = await ctx.admin
    .from("bookings")
    .select("customer_id,provider_id")
    .eq("id", id)
    .maybeSingle();
  if (
    !booking ||
    (booking.customer_id !== ctx.user.id &&
      !(ctx.providerId && booking.provider_id === ctx.providerId))
  )
    return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  const { data, error } = await ctx.admin
    .from("cleaning_job_evidence")
    .select("*")
    .eq("booking_id", id)
    .maybeSingle();
  const photos = await ctx.admin
    .from("cleaning_job_photos")
    .select("id,stage,created_at")
    .eq("booking_id", id)
    .order("created_at");
  if (error || photos.error)
    return NextResponse.json(
      { error: "Checklist unavailable." },
      { status: 503 },
    );
  return NextResponse.json(
    { evidence: data, photos: photos.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await accountContext(req, {
    mutation: true,
    approvedProvider: true,
  });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(req);
  if (body instanceof NextResponse) return body;
  const { id } = await params;
  const client = await createClient();
  const { error } = await client.rpc("save_cleaning_job_evidence", {
    p_booking: id,
    p_scope: body.scope === true,
    p_hazards: body.hazards === true,
    p_hazard_note: String(body.hazardNote ?? ""),
    p_tasks: body.tasks ?? {},
    p_photo_note: String(body.photoNote ?? ""),
    p_finish: body.finish === true,
  });
  return NextResponse.json(error ? { error: error.message } : { ok: true }, {
    status: error ? 409 : 200,
  });
}
