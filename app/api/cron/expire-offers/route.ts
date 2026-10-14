// Expire unclaimed offers. Save at: app/api/cron/expire-offers/route.ts
//
// Run this every 10–15 minutes from n8n (or any scheduler):
//   GET http://localhost:3000/api/cron/expire-offers?key=YOUR_SECRET
//
// Add to .env.local:  CRON_SECRET=some-long-random-string

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { refundUnfilledPrepaidVisit } from "@/lib/prepaidVisitRefund";
import { createVisitBilling } from "@/lib/visitBillingServer";
import {
  claimMoneyOperation,
  systemFinaliseMoneyOperation,
  systemTransitionBooking,
  systemTransitionPayment,
} from "@/lib/bookingState";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const secret = process.env.CRON_SECRET;
  if (!secret || (key !== secret && bearer !== secret)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const now = new Date().toISOString();

  // Still on offer, past the deadline, nobody claimed it.
  const { data: stale } = await admin
    .from("bookings")
    .select(
      "id, customer_id, customer_email, scheduled_at, regular_series_id, packages(name)",
    )
    .eq("status", "offered")
    .is("provider_id", null)
    .lt("offer_expires_at", now)
    .limit(50);

  const expired: string[] = [];

  for (const b of stale ?? []) {
    const { data: visitBilling } = await admin
      .from("booking_visit_billing")
      .select("booking_id,active_operation_id")
      .eq("booking_id", b.id)
      .maybeSingle();
    if (visitBilling) {
      if (!visitBilling.active_operation_id) {
        await createVisitBilling(admin, stripe).cancel(b.id, null, true);
        expired.push(b.id);
      }
      continue;
    }
    const pkg = b.packages as { name: string } | { name: string }[] | null;
    const service =
      (Array.isArray(pkg) ? pkg[0]?.name : pkg?.name) ?? "your booking";

    // 1. Cancel the booking
    await systemTransitionBooking(
      admin,
      b.id,
      "cancelled",
      "Offer expired with nobody accepting",
    );

    // 2. Close the outstanding offers
    await admin
      .from("booking_offers")
      .update({ status: "expired" })
      .eq("booking_id", b.id)
      .eq("status", "open");

    // 3. One-time visits release a hold. Upfront series visits refund only
    //    this visit's share of the shared six-visit charge.
    const { data: pays } = await admin
      .from("payments")
      .select("id, stripe_payment_ref, status, gross_amount")
      .eq("booking_id", b.id)
      .limit(1);

    const pay = pays?.[0];
    let financialMessage = "Nothing was charged.";
    if (b.regular_series_id) {
      try {
        await refundUnfilledPrepaidVisit(b.id);
        financialMessage = `The prepaid amount for this visit (£${Number(pay?.gross_amount ?? 0).toFixed(2)}) has been refunded; your other booked visits remain unchanged.`;
      } catch (cause) {
        financialMessage =
          "This visit's prepaid refund needs attention. Support has been notified; please do not pay again.";
        console.error(
          `Could not refund unfilled prepaid visit ${b.id}:`,
          cause,
        );
      }
    } else if (pay?.stripe_payment_ref && pay.status === "authorised") {
      const operationKey = `release:booking:${b.id}`;
      try {
        await systemTransitionPayment(admin, pay.id, "cancelling");
        const op = await claimMoneyOperation(admin, {
          operationKey,
          operationType: "release",
          bookingId: b.id,
          amount: Number(pay.gross_amount ?? 0),
        });
        if (op.should_run) {
          const intent = await stripe.paymentIntents.cancel(
            pay.stripe_payment_ref,
            {},
            { idempotencyKey: operationKey },
          );
          await systemFinaliseMoneyOperation(admin, op.id, "succeeded", {
            stripeObjectId: intent.id,
          });
          await systemTransitionPayment(admin, pay.id, "cancelled");
        } else if (op.status === "succeeded") {
          await systemTransitionPayment(admin, pay.id, "cancelled");
        } else if (op.status === "ambiguous") {
          throw new Error("Hold release outcome is ambiguous");
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : "Hold release failed";
        await systemTransitionPayment(admin, pay.id, "authorised", {
          reason,
        }).catch(() => undefined);
        await admin.rpc("open_review_case", {
          p_booking_id: b.id,
          p_category: "payment_failure",
          p_priority: "high",
          p_blocks_payment: true,
          p_blocks_payout: true,
          p_notes: reason,
          p_created_by: null,
        });
      }
    }

    // 4. Tell the client
    if (b.customer_id) {
      await admin.from("notifications").insert({
        user_id: b.customer_id,
        title: "We couldn't fill your booking",
        body: `${service} — no provider was free for that time, so we've cancelled it. ${financialMessage}`,
        href: "/book",
      });
    }
    await sendEmail({
      to: b.customer_email,
      subject: "We couldn't fill your booking",
      title: "No provider available",
      body: `<p>We're sorry — no provider was free for your <strong>${service}</strong>, so we've cancelled the booking.</p>
             <p>${financialMessage}</p>
             <p>Try another time and we'll find someone.</p>`,
      cta: { text: "Book another time", url: "/book" },
    });

    expired.push(b.id);
  }

  return NextResponse.json({ checked: stale?.length ?? 0, expired });
}
