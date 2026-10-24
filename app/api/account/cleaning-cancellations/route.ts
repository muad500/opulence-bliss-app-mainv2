import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { createClient } from "@/lib/supabase/server";
import { createVisitBilling } from "@/lib/visitBillingServer";

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true });
  if (isAccountError(ctx)) return ctx;
  const client = await createClient();
  const { data, error } = await client
    .from("cleaning_cancellation_settlements")
    .select(
      "booking_id,charge_percent,charge_pence,cleaner_pay_pence,waived_pence,revision,created_at",
    )
    .eq("provider_id", ctx.providerId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error)
    return NextResponse.json(
      { error: "Cancellation compensation could not be loaded." },
      { status: 503 },
    );
  return NextResponse.json(
    { rows: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (
    typeof body.bookingId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.bookingId) ||
    !Number.isSafeInteger(body.amountPence) ||
    Number(body.amountPence) <= 0 ||
    !Number.isSafeInteger(body.revision)
  )
    return NextResponse.json(
      { error: "Choose a valid compensation amount to waive." },
      { status: 400 },
    );
  const client = await createClient();
  const { data, error } = await client.rpc(
    "prepare_cleaning_cancellation_adjustment",
    {
      p_booking: body.bookingId,
      p_action: "waive",
      p_value: body.amountPence,
      p_revision: body.revision,
    },
  );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 409 });
  const result = await createVisitBilling(
    ctx.admin,
    new Stripe(process.env.STRIPE_SECRET_KEY!),
  ).run(data.id);
  return NextResponse.json(result);
}
