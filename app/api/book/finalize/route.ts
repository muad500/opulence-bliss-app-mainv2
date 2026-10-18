import { finalizePerVisitCheckout } from "@/lib/finalizePerVisitCheckout";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { finalizeCustomerCheckout } from "@/lib/finalizeCustomerCheckout";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function isBookingInfrastructureFailure(error: unknown) {
  let detail: string;
  try {
    detail =
      error instanceof Error
        ? `${error.name} ${error.message}`
        : JSON.stringify(error);
  } catch {
    detail = String(error);
  }
  return /PGRST202|schema cache|finalize_(regular_)?customer_checkout|duration_minutes|checkout_session_id/i.test(
    detail,
  );
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  const target = new URL("/book/success", req.nextUrl.origin);
  if (!sessionId) {
    target.searchParams.set("error", "missing_session");
    return NextResponse.redirect(target);
  }

  try {
    const ssr = await createServerClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();
    if (!user) {
      const login = new URL("/login", req.nextUrl.origin);
      login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(login);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "setup_intent"],
    });
    const setup = session.mode === "setup";
    const pi = (setup ? session.setup_intent : session.payment_intent) as
      | Stripe.PaymentIntent
      | Stripe.SetupIntent;
    if (!pi || typeof pi === "string") throw new Error("Payment is missing.");
    const ok = pi.status === "requires_capture" || pi.status === "succeeded";
    if (!ok) {
      target.searchParams.set("session_id", sessionId);
      target.searchParams.set("error", "payment_not_authorised");
      return NextResponse.redirect(target);
    }

    if (
      session.client_reference_id !== user.id ||
      pi.metadata?.customer_id !== user.id ||
      pi.metadata?.kind !== "booking"
    ) {
      return NextResponse.json(
        { error: "Checkout does not belong to this account." },
        { status: 403 },
      );
    }
    if (setup) await finalizePerVisitCheckout(session, pi);
    else await finalizeCustomerCheckout(session, pi as Stripe.PaymentIntent);

    target.searchParams.set("session_id", sessionId);
    target.searchParams.set("saved", "1");
    return NextResponse.redirect(target);
  } catch (error) {
    console.error("Booking finalisation failed:", error);
    target.searchParams.set("session_id", sessionId);
    target.searchParams.set(
      "error",
      isBookingInfrastructureFailure(error)
        ? "booking_update_pending"
        : "finalize_failed",
    );
    return NextResponse.redirect(target);
  }
}
