// Tip a provider after a completed visit. 100% goes to them.
// Save at: app/api/tip/route.ts

import { bookingCleaningBillingTerms } from "@/lib/cleaningBillingSettings";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getOrCreateBillingCustomer } from "@/lib/accountBilling";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const { bookingId, amount } = await req.json();
    const pence = Math.round(Number(amount) * 100);

    if (
      !bookingId ||
      !Number.isSafeInteger(pence) ||
      pence <= 0 ||
      !/^\d+(\.\d{1,2})?$/.test(String(amount))
    ) {
      return NextResponse.json(
        { error: "Enter a valid tip with up to two decimal places." },
        { status: 400 },
      );
    }

    const ssr = await createServerClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Please log in." }, { status: 401 });
    }

    // The booking must be the customer's, and completed.
    const { data: booking } = await admin
      .from("bookings")
      .select("id, customer_id, provider_id, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking || booking.customer_id !== user.id) {
      return NextResponse.json(
        { error: "Booking not found." },
        { status: 404 },
      );
    }
    if (booking.status !== "completed") {
      return NextResponse.json(
        { error: "You can tip once the visit is complete." },
        { status: 400 },
      );
    }
    if (!booking.provider_id) {
      return NextResponse.json(
        { error: "No provider on this booking." },
        { status: 400 },
      );
    }

    const terms = await bookingCleaningBillingTerms(admin, bookingId);
    if (pence < terms.tipMinimumPence)
      return NextResponse.json(
        {
          error: `Enter a tip of at least £${(terms.tipMinimumPence / 100).toFixed(2)}.`,
        },
        { status: 400 },
      );

    // Keep the payouts fix (no destination, so never the test account) and the
    // account work's saved Stripe customer.
    const billingCustomer = await getOrCreateBillingCustomer(stripe, {
      id: user.id,
      email: user.email,
    });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: user.id,
      customer: billingCustomer,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: pence,
            product_data: {
              name: "Tip for your provider",
              description: "Goes entirely to the person who did the work.",
            },
          },
        },
      ],
      payment_intent_data: {
        // Keep the captured tip on the platform until we can transfer it to
        // the assigned cleaner's account, with an auditable retry path.
        transfer_group: `ob_tip_${crypto.randomUUID()}`,
        metadata: {
          kind: "tip",
          booking_id: bookingId,
          tip_minimum_pence: String(terms.tipMinimumPence),
        },
      },
      success_url: `${req.nextUrl.origin}/api/tip/finalize?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.nextUrl.origin}/account`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't start the tip";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const ssr = await createServerClient();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const bookingId = request.nextUrl.searchParams.get("bookingId");
  const { data: booking } = await admin
    .from("bookings")
    .select("customer_id")
    .eq("id", bookingId ?? "")
    .maybeSingle();
  if (booking?.customer_id !== user.id)
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  try {
    const terms = await bookingCleaningBillingTerms(admin, bookingId!);
    return NextResponse.json(
      { minimumPence: terms.tipMinimumPence },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Tip details could not be loaded." },
      { status: 503 },
    );
  }
}
