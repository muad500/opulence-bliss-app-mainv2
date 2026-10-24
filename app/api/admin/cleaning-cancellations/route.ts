import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminApi } from "@/lib/adminApi";
import { createVisitBilling } from "@/lib/visitBillingServer";

export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.client
    .from("cleaning_cancellation_settlements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error)
    return NextResponse.json(
      { error: "Cancellations could not be loaded." },
      { status: 503 },
    );
  return NextResponse.json(
    { rows: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send a cancellation adjustment." },
      { status: 400 },
    );
  }
  if (
    typeof body.bookingId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.bookingId) ||
    !Number.isSafeInteger(body.chargePercent) ||
    Number(body.chargePercent) < 0 ||
    Number(body.chargePercent) > 70
  )
    return NextResponse.json(
      { error: "Choose a cancellation charge from 0% to 70%." },
      { status: 400 },
    );
  const engine = createVisitBilling(
    ctx.admin,
    new Stripe(process.env.STRIPE_SECRET_KEY!),
  );
  try {
    if (body.action === "no_access") {
      const { booking, terms } = await engine.load(body.bookingId);
      if (terms.cancellationBasis !== "cleaning_hours")
        throw new Error(
          "This older booking needs its agreed cancellation terms reviewed separately.",
        );
      const result = await engine.cancel(
        body.bookingId,
        booking.customer_id,
        false,
        undefined,
        false,
        {
          actorId: ctx.user.id,
          chargePercent: Number(body.chargePercent),
          noAccess: true,
        },
      );
      return NextResponse.json(result);
    }
    if (body.action !== "reduce_charge" || !Number.isSafeInteger(body.revision))
      throw new Error("Review the latest cancellation first.");
    const { data, error } = await ctx.client.rpc(
      "prepare_cleaning_cancellation_adjustment",
      {
        p_booking: body.bookingId,
        p_action: "reduce_charge",
        p_value: body.chargePercent,
        p_revision: body.revision,
      },
    );
    if (error) throw new Error(error.message);
    return NextResponse.json(await engine.run(data.id));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Cancellation adjustment needs review.",
      },
      { status: 409 },
    );
  }
}
