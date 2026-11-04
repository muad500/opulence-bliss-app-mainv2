import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  accountContext,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import { createClient } from "@/lib/supabase/server";
import { createVisitBilling } from "@/lib/visitBillingServer";
export async function POST(req: NextRequest) {
  const ctx = await accountContext(req, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(req);
  if (body instanceof NextResponse) return body;
  if (body.confirm !== true || !Number.isSafeInteger(body.revision))
    return NextResponse.json(
      { error: "Review and confirm free cancellation." },
      { status: 400 },
    );
  const client = await createClient();
  const op = await client.rpc("prepare_recorded_visit_outcome", {
    p_booking: body.bookingId,
    p_mode: "replacement_cancel",
    p_reason:
      "Customer chose free cancellation after their cleaner could not attend",
    p_worked: null,
    p_revision: body.revision,
  });
  if (op.error || !op.data)
    return NextResponse.json(
      { error: op.error?.message ?? "Cancellation unavailable." },
      { status: 409 },
    );
  const result = await createVisitBilling(
    ctx.admin,
    new Stripe(process.env.STRIPE_SECRET_KEY!),
  ).run(op.data.id);
  return NextResponse.json(result);
}
