import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getOrCreateBillingCustomer } from "@/lib/accountBilling";
import { accountContext, isAccountError } from "@/lib/accountApi";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Payment settings are temporarily unavailable." }, { status: 503 });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const customer = await getOrCreateBillingCustomer(stripe, { id: ctx.user.id, email: ctx.user.email });
    const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    let configuration = configurations.data.find((item) => item.metadata?.opulence_purpose === "saved_payment_methods");
    if (!configuration) {
      configuration = await stripe.billingPortal.configurations.create({
        features: { payment_method_update: { enabled: true } },
        metadata: { opulence_purpose: "saved_payment_methods" },
      });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer,
      configuration: configuration.id,
      return_url: new URL("/account/profile", request.url).toString(),
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Billing portal unavailable:", error);
    return NextResponse.json({ error: "Could not open secure payment settings. Please try again later." }, { status: 503 });
  }
}
