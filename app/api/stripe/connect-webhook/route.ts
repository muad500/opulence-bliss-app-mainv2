import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { stripePayoutAccountChanged } from "@/lib/accountSecurityAlerts";

// Separate Connect signing secret: never replace the payment webhook secret.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature)
    return NextResponse.json(
      { error: "Connect webhook unavailable" },
      { status: 400 },
    );
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      secret,
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    );
  }
  if (
    !stripePayoutAccountChanged(
      event.type,
      event.data.previous_attributes as Record<string, unknown> | undefined,
    )
  )
    return NextResponse.json({ received: true });
  const connectedId = event.account;
  if (!connectedId)
    return NextResponse.json(
      { error: "Connected account required" },
      { status: 400 },
    );
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: provider, error } = await admin
      .from("providers")
      .select("profile_id")
      .eq("stripe_account_id", connectedId)
      .maybeSingle();
    if (error) throw new Error();
    if (provider) {
      const queued = await admin.rpc("queue_account_security_alert", {
        p_user: provider.profile_id,
        p_event: `stripe:${event.id}`,
      });
      if (queued.error) throw new Error();
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: "Security notification needs retry" },
      { status: 500 },
    );
  }
}
