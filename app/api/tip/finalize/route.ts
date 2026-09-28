import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { finalizeTipCheckout } from "@/lib/finalizeTipCheckout";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  const target = new URL("/account/tip/success", req.nextUrl.origin);
  if (!sessionId) {
    target.searchParams.set("error", "missing_session");
    return NextResponse.redirect(target);
  }

  try {
    const ssr = await createServerClient();
    const { data: { user } } = await ssr.auth.getUser();
    if (!user) {
      const login = new URL("/login", req.nextUrl.origin);
      login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(login);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    const pi = session.payment_intent as Stripe.PaymentIntent;
    if (!pi || typeof pi === "string" || session.client_reference_id !== user.id) {
      return NextResponse.json({ error: "Checkout does not belong to this account." }, { status: 403 });
    }
    const result = await finalizeTipCheckout(session, pi);

    target.searchParams.set("session_id", sessionId);
    target.searchParams.set("saved", "1");
    target.searchParams.set("payout", result.payoutSettled ? "sent" : "pending");
    return NextResponse.redirect(target);
  } catch (error) {
    console.error("Tip finalisation failed:", error);
    target.searchParams.set("session_id", sessionId);
    target.searchParams.set("error", "finalize_failed");
    return NextResponse.redirect(target);
  }
}
