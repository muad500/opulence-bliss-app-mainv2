import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import {
  accountContext,
  isAccountError,
  isSameOriginMutation,
  readAccountBody,
} from "@/lib/accountApi";
import { createVisitBilling } from "@/lib/visitBillingServer";
import { regularSeriesControlPlan } from "@/lib/regularSeriesControl";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id))
    return NextResponse.json({ error: "Series not found." }, { status: 404 });
  const client = await createClient();
  const { data, error } = await client.rpc("regular_series_billing_state", {
    p_series: id,
  });
  if (error)
    return NextResponse.json({ error: "Series not found." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Use the website to manage your visits." },
      { status: 403 },
    );
  const { id } = await context.params;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (
    !uuid.test(id) ||
    !["resume", "pause", "end"].includes(String(body.action))
  )
    return NextResponse.json(
      { error: "Choose how to manage your regular booking." },
      { status: 400 },
    );
  if (body.action === "resume") {
    if (body.confirm !== true || !Number.isSafeInteger(body.generation))
      return NextResponse.json(
        { error: "Confirm the visits to resume." },
        { status: 400 },
      );
    const client = await createClient();
    const { data, error } = await client.rpc("resume_regular_series", {
      p_series: id,
      p_generation: body.generation,
    });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json(data);
  }
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  try {
    const engine = createVisitBilling(
      ctx.admin,
      new Stripe(process.env.STRIPE_SECRET_KEY!),
    );
    const plan = await regularSeriesControlPlan(
      ctx.admin,
      engine,
      id,
      ctx.user.id,
      body.action as "pause" | "end",
    );
    if (body.preview === true)
      return NextResponse.json(plan, {
        headers: { "Cache-Control": "no-store" },
      });
    if (body.confirm !== true || body.fingerprint !== plan.fingerprint)
      return NextResponse.json(
        { error: "The visits changed. Review the cancellation amounts again." },
        { status: 409 },
      );
    const result = await ctx.admin.rpc("control_regular_series", {
      p_series: id,
      p_customer: ctx.user.id,
      p_action: body.action,
      p_generation: plan.generation,
      p_visits: plan.visits,
    });
    if (result.error) throw new Error(result.error.message);
    // The pause and every cancellation operation are prepared atomically. The
    // normal scheduler recovers these same IDs after a disconnected request.
    let processing = false;
    for (const operation of (result.data?.operations ?? []) as string[]) {
      try {
        if ((await engine.run(operation)).status !== "succeeded")
          processing = true;
      } catch {
        processing = true;
      }
    }
    return NextResponse.json({ ...result.data, processing });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The regular booking could not be updated.",
      },
      { status: 409 },
    );
  }
}
