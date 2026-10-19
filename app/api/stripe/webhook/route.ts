import { finalizePerVisitCheckout } from "@/lib/finalizePerVisitCheckout";
// SETUP: mkdir -p "app/api/stripe/webhook" && code "app/api/stripe/webhook/route.ts"
//
// Stripe webhook — the source of truth for subscription money.
//
// Local testing (needs the Stripe CLI, running in its own terminal):
//   stripe login
//   stripe listen --forward-to localhost:3000/api/stripe/webhook
// Copy the whsec_... it prints into .env.local as STRIPE_WEBHOOK_SECRET.

import { finalizeHandymanCheckout } from "@/lib/handymanServer";
import {
  finalizeHandymanQuoteCheckout,
  reviewHandymanQuoteDispute,
} from "@/lib/handymanQuoteServer";
import { finalizeCustomerCheckout } from "@/lib/finalizeCustomerCheckout";
import { finalizeTipCheckout } from "@/lib/finalizeTipCheckout";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripePayoutAccountChanged } from "@/lib/accountSecurityAlerts";
import { createClient } from "@supabase/supabase-js";
import { createVisitBilling } from "@/lib/visitBillingServer";
import {
  upsertSubscription,
  subscriptionIdFromInvoice,
  invoicePeriod,
} from "@/lib/subscriptions";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 400 });
  }
  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error("Bad webhook signature:", e);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  console.log("Stripe webhook:", event.type);

  try {
    if (
      stripePayoutAccountChanged(
        event.type,
        event.data.previous_attributes as Record<string, unknown> | undefined,
      )
    ) {
      const connectedId =
        event.account ??
        (event.type === "account.updated"
          ? (event.data.object as Stripe.Account).id
          : null);
      if (connectedId) {
        const { data: provider, error } = await admin
          .from("providers")
          .select("profile_id")
          .eq("stripe_account_id", connectedId)
          .maybeSingle();
        if (error) throw new Error("Payout security alert lookup failed");
        if (provider) {
          const queued = await admin.rpc("queue_account_security_alert", {
            p_user: provider.profile_id,
            p_event: `stripe:${event.id}`,
          });
          if (queued.error)
            throw new Error("Payout security alert could not be queued");
        }
      }
    }
    if (
      event.type === "customer.updated" &&
      event.data.previous_attributes &&
      "invoice_settings" in event.data.previous_attributes
    ) {
      const customer = event.data.object as Stripe.Customer;
      // The charge worker retrieves the CURRENT default card; a delayed
      // event only brings the next retry forward, never restores an old card.
      const { error } = await admin.rpc("retry_assigned_customer_visits", {
        p_customer: customer.id,
      });
      if (error) throw new Error("Saved-card retry could not be scheduled.");
    }
    // Retrieve current Stripe state: an old event must never restore stale
    // scope, card preferences or a payment that has already been refunded.
    if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed"
    ) {
      const object = event.data.object as Stripe.PaymentIntent;
      const intent = await stripe.paymentIntents.retrieve(object.id);
      if (
        intent.metadata.kind === "visit_charge" &&
        intent.metadata.visit_operation
      ) {
        const { data: operation } = await admin
          .from("booking_visit_money_operations")
          .select("id,booking_id")
          .eq("id", intent.metadata.visit_operation)
          .maybeSingle();
        if (!operation || operation.booking_id !== intent.metadata.booking_id)
          throw new Error("Visit operation mismatch.");
        await createVisitBilling(admin, stripe).run(operation.id);
      }
    }
    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId =
        typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
      await reviewHandymanQuoteDispute(admin, chargeId);
    }
    if (event.type === "refund.updated") {
      const refund = event.data.object as Stripe.Refund;
      if (refund.metadata?.visit_operation)
        await createVisitBilling(admin, stripe).run(
          refund.metadata?.visit_operation,
        );
    }
    // ---- Subscription just started (fires right after Checkout) ----
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      if (
        session.mode === "payment" &&
        session.client_reference_id &&
        session.payment_intent
      ) {
        try {
          const paymentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent.id;
          const payment = await stripe.paymentIntents.retrieve(paymentId);
          if (payment.metadata.kind === "booking")
            await finalizeCustomerCheckout(session, payment);
          if (payment.metadata.kind === "tip")
            await finalizeTipCheckout(session, payment);
          if (payment.metadata.kind === "handyman")
            await finalizeHandymanCheckout(admin, stripe, session, payment);
          if (payment.metadata.kind === "handyman_quote")
            await finalizeHandymanQuoteCheckout(
              admin,
              stripe,
              session,
              payment,
            );
        } catch {
          console.error("Booking webhook finalisation failed; retry required.");
          return NextResponse.json(
            { error: "Booking finalisation failed; retry required." },
            { status: 500 },
          );
        }
      }

      if (
        session.mode === "setup" &&
        session.client_reference_id &&
        session.setup_intent &&
        session.metadata?.kind === "booking" &&
        session.metadata?.billing_model === "per_visit"
      ) {
        const id =
          typeof session.setup_intent === "string"
            ? session.setup_intent
            : session.setup_intent.id;
        await finalizePerVisitCheckout(
          session,
          await stripe.setupIntents.retrieve(id),
        );
      }

      if (session.mode === "subscription" && session.subscription) {
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;

        const stripeSub = await stripe.subscriptions.retrieve(subId);
        const invoiceId =
          typeof session.invoice === "string"
            ? session.invoice
            : session.invoice?.id;
        const invoice = invoiceId
          ? await stripe.invoices.retrieve(invoiceId)
          : null;
        const result = await upsertSubscription(stripeSub, {
          amountPence: invoice?.amount_paid ?? session.amount_total ?? 0,
          ref: String(
            (invoice as (Stripe.Invoice & { payment_intent?: string }) | null)
              ?.payment_intent ??
              invoice?.id ??
              session.id,
          ),
          ...(invoice ? invoicePeriod(invoice) : {}),
        });
        console.log("Subscription set up:", result);
      }
    }

    // ---- Later billing cycles ----
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = subscriptionIdFromInvoice(invoice);

      if (!subId) {
        console.log("invoice.paid with no subscription — ignoring");
        return NextResponse.json({ received: true });
      }

      const stripeSub = await stripe.subscriptions.retrieve(subId);
      const result = await upsertSubscription(stripeSub, {
        amountPence: invoice.amount_paid ?? 0,
        ref: String(
          (invoice as { payment_intent?: string }).payment_intent ?? invoice.id,
        ),
        ...invoicePeriod(invoice),
      });
      console.log("Subscription cycle billed:", result);
    }

    // ---- Payment failed ----
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = subscriptionIdFromInvoice(invoice);
      if (subId) {
        await admin
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", subId);
      }
    }

    // ---- Cancelled ----
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await admin
        .from("subscriptions")
        .update({ status: "cancelled" })
        .eq("stripe_subscription_id", sub.id);
    }

    return NextResponse.json({ received: true });
  } catch {
    console.error("Webhook handling failed; retry required.");
    return NextResponse.json(
      { error: "Webhook reconciliation must retry." },
      { status: 500 },
    );
  }
}
