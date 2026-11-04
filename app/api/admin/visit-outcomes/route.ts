import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminApi } from "@/lib/adminApi";
import { createVisitBilling } from "@/lib/visitBillingServer";
export async function GET(req: NextRequest) {
  const ctx = await adminApi(req);
  if (ctx instanceof NextResponse) return ctx;
  const id = req.nextUrl.searchParams.get("booking");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "Choose a booking." }, { status: 400 });
  const bill = await ctx.admin
    .from("booking_visit_billing")
    .select("revision,status,amount_pence")
    .eq("booking_id", id)
    .maybeSingle();
  const outcome = await ctx.client
    .from("staff_visit_outcomes")
    .select("*")
    .eq("booking_id", id)
    .maybeSingle();
  if (bill.error || !bill.data || outcome.error)
    return NextResponse.json({ error: "Visit unavailable." }, { status: 404 });
  return NextResponse.json(
    { bill: bill.data, outcome: outcome.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(req: NextRequest) {
  const ctx = await adminApi(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await req.json();
    if (
      !["unsafe_home", "disrespect", "customer_stopped"].includes(body.mode) ||
      !Number.isSafeInteger(body.revision)
    )
      throw Error("Choose an outcome and review the latest visit.");
    const op = await ctx.client.rpc("prepare_recorded_visit_outcome", {
      p_booking: body.bookingId,
      p_mode: body.mode,
      p_reason: body.reason,
      p_worked: body.mode === "customer_stopped" ? body.workedMinutes : null,
      p_revision: body.revision,
    });
    if (op.error || !op.data)
      throw Error(op.error?.message ?? "Decision unavailable.");
    const result = await createVisitBilling(
      ctx.admin,
      new Stripe(process.env.STRIPE_SECRET_KEY!),
    ).run(op.data.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Visit needs review." },
      { status: 409 },
    );
  }
}
