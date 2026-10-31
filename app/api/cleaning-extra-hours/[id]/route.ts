import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { createClient } from "@/lib/supabase/server";
import { createVisitBilling } from "@/lib/visitBillingServer";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, context: Context) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;
  const { id } = await context.params;
  if (!uuid.test(id))
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  const b = await ctx.admin
    .from("bookings")
    .select("customer_id,provider_id,status,duration_minutes")
    .eq("id", id)
    .maybeSingle();
  const customer = b.data?.customer_id === ctx.user.id;
  const worker = Boolean(
    ctx.providerId && b.data?.provider_id === ctx.providerId,
  );
  if (b.error || !b.data || (!customer && !worker))
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  const bill = await ctx.admin
    .from("booking_visit_billing")
    .select("status,active_operation_id,policy_refund_required")
    .eq("booking_id", id)
    .maybeSingle();
  if (bill.error)
    return NextResponse.json(
      { error: "Visit payment unavailable" },
      { status: 503 },
    );
  const offers = await ctx.admin
    .from("cleaning_extra_hours_offers")
    .select("id,minutes,amount_pence,status,created_at")
    .eq("booking_id", id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (offers.error)
    return NextResponse.json(
      { error: "Extra time unavailable" },
      { status: 503 },
    );
  const activeVisit = ["scheduled", "in_progress"].includes(b.data.status);
  const qualified = b.data.provider_id
    ? await ctx.admin.rpc("provider_service_approved", {
        p_provider: b.data.provider_id,
        p_service: "cleaning",
      })
    : { data: false, error: null };
  return NextResponse.json(
    {
      worker,
      offer: offers.data?.[0] ?? null,
      canOffer:
        worker &&
        !customer &&
        qualified.data === true &&
        !qualified.error &&
        ctx.professionalApproved &&
        activeVisit &&
        bill.data?.status === "paid" &&
        !bill.data.active_operation_id &&
        !bill.data.policy_refund_required,
      canApprove:
        customer &&
        qualified.data === true &&
        !qualified.error &&
        activeVisit &&
        bill.data?.status === "paid" &&
        !bill.data.active_operation_id &&
        !bill.data.policy_refund_required,
      maxMinutes: Math.max(0, Math.min(360, 480 - b.data.duration_minutes)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest, context: Context) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const { id } = await context.params;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (!uuid.test(id) || body.confirm !== true)
    return NextResponse.json(
      { error: "Confirm the extra-time action" },
      { status: 400 },
    );
  try {
    const client = await createClient();
    if (body.action === "offer" && Number.isSafeInteger(body.minutes)) {
      const { error } = await client.rpc("offer_cleaning_extra_hours", {
        p_booking: id,
        p_minutes: body.minutes,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ status: "offered" });
    }
    if (typeof body.offerId !== "string" || !uuid.test(body.offerId))
      return NextResponse.json(
        { error: "Choose the current extra-time offer" },
        { status: 400 },
      );
    const booking = await ctx.admin
      .from("bookings")
      .select("customer_id,provider_id")
      .eq("id", id)
      .single();
    const offer = await ctx.admin
      .from("cleaning_extra_hours_offers")
      .select("booking_id")
      .eq("id", body.offerId)
      .single();
    if (
      booking.error ||
      offer.error ||
      offer.data.booking_id !== id ||
      (booking.data.customer_id !== ctx.user.id &&
        (!ctx.providerId || booking.data.provider_id !== ctx.providerId))
    )
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    if (body.action === "decline") {
      const { error } = await client.rpc("decline_cleaning_extra_hours", {
        p_offer: body.offerId,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ status: "declined" });
    }
    if (
      body.action !== "approve" ||
      !Number.isSafeInteger(body.amountPence) ||
      booking.data.customer_id !== ctx.user.id
    )
      return NextResponse.json(
        { error: "The customer must approve the displayed payment" },
        { status: 400 },
      );
    const prepared = await ctx.admin.rpc("prepare_cleaning_extra_hours", {
      p_offer: body.offerId,
      p_customer: ctx.user.id,
      p_amount: body.amountPence,
    });
    if (prepared.error) throw new Error(prepared.error.message);
    if (prepared.data.status === "paid")
      return NextResponse.json({ status: "succeeded" });
    if (["payment_failed", "review"].includes(prepared.data.status))
      return NextResponse.json({ status: prepared.data.status });
    const engine = createVisitBilling(
      ctx.admin,
      new Stripe(process.env.STRIPE_SECRET_KEY!),
    );
    const outcome = await engine.run(prepared.data.operation);
    const saved = await ctx.admin
      .from("cleaning_extra_hours_offers")
      .select("status")
      .eq("id", body.offerId)
      .single();
    if (saved.error) return NextResponse.json({ status: "processing" });
    return NextResponse.json({
      status:
        saved.data.status === "paid"
          ? "succeeded"
          : saved.data.status === "processing"
            ? outcome.status === "failed"
              ? "payment_failed"
              : "processing"
            : saved.data.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Stripe.errors.StripeError
            ? "The saved card needs attention. The original visit remains recorded."
            : error instanceof Error
              ? error.message
              : "Extra time could not be updated",
      },
      { status: 409 },
    );
  }
}
