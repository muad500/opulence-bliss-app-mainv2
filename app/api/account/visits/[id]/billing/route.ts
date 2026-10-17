import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { createVisitBilling } from "@/lib/visitBillingServer";
import { calculateCancellationPolicy } from "@/lib/cancellationPolicy";
import { visitExtrasCanChange } from "@/lib/visitBillingPolicy";

type RouteContext = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;
  const { id } = await context.params;
  const { data: owned } = await ctx.admin
    .from("bookings")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  if (owned?.customer_id !== ctx.user.id)
    return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  const { data: billing, error } = await ctx.admin
    .from("booking_visit_billing")
    .select("booking_id")
    .eq("booking_id", id)
    .maybeSingle();
  if (error || !billing)
    return NextResponse.json(
      { model: "legacy" },
      { headers: { "Cache-Control": "no-store" } },
    );
  try {
    const engine = createVisitBilling(
      ctx.admin,
      new Stripe(process.env.STRIPE_SECRET_KEY!),
    );
    const { booking, bill, charges } = await engine.load(id, ctx.user.id);
    const paidPence = charges.reduce(
      (sum, c) => sum + c.amount_pence - c.refunded_pence,
      0,
    );
    return NextResponse.json(
      {
        model: "per_visit",
        revision: bill.revision,
        status: bill.status,
        processing: Boolean(bill.active_operation_id),
        amountPence: bill.amount_pence,
        paidPence,
        dueAt: bill.charge_due_at,
        cardUpdateDeadline: bill.late_payment_grace_until,
        lines: bill.line_items,
        addons: booking.cleaning_extras.addons,
        bringsProducts: booking.cleaning_extras.bringsProducts,
        canChange:
          ["offered", "declined", "scheduled"].includes(booking.status) &&
          visitExtrasCanChange(booking.scheduled_at) &&
          bill.status !== "review" &&
          !bill.policy_refund_required &&
          !bill.active_operation_id,
        cancellationPolicy: calculateCancellationPolicy(
          booking.scheduled_at,
          paidPence / 100,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Visit payments could not be loaded." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const { id } = await context.params;
  try {
    const engine = createVisitBilling(
      ctx.admin,
      new Stripe(process.env.STRIPE_SECRET_KEY!),
    );
    const input = { addons: body.addons, bringsProducts: body.bringsProducts };
    if (body.action === "quote") {
      const quote = await engine.quoteExtras(id, ctx.user.id, input);
      return NextResponse.json({
        revision: quote.revision,
        amountPence: quote.amountPence,
        chargePence: quote.chargePence,
        refundPence: quote.refundPence,
        durationMinutes: quote.durationMinutes,
        changed: quote.changed,
      });
    }
    if (
      body.action !== "confirm" ||
      body.confirm !== true ||
      ![body.revision, body.chargePence, body.refundPence].every(
        Number.isSafeInteger,
      )
    ) {
      return NextResponse.json(
        { error: "Review and confirm the payment change." },
        { status: 400 },
      );
    }
    const result = await engine.changeExtras(id, ctx.user.id, {
      ...input,
      revision: Number(body.revision),
      chargePence: Number(body.chargePence),
      refundPence: Number(body.refundPence),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Stripe.errors.StripeError
        ? "The card update needs attention."
        : error instanceof Error
          ? error.message
          : "The visit could not be updated.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
