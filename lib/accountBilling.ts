import "server-only";
import type Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/** The mapping is private and environment-specific. Card details stay in Stripe. */
export async function getOrCreateBillingCustomer(stripe: Stripe, user: { id: string; email?: string | null }) {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: existing, error: lookupError } = await admin
    .from("account_billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) throw new Error("Billing customer storage is not ready.");
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string;

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { opulence_user_id: user.id },
  }, { idempotencyKey: `opulence-billing-customer-${user.id}` });
  const { error: saveError } = await admin.from("account_billing_customers").insert({
    user_id: user.id,
    stripe_customer_id: customer.id,
  });
  if (saveError) {
    // A simultaneous request may have saved the mapping first.
    const { data: winner } = await admin.from("account_billing_customers")
      .select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (winner?.stripe_customer_id) return winner.stripe_customer_id as string;
    throw new Error("Could not save your billing customer. No payment was started.");
  }
  return customer.id;
}
