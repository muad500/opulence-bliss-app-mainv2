import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, type AccountContext } from "@/lib/accountApi";

async function stripeAccount(ctx: AccountContext) {
  const { data, error } = await ctx.admin.from("providers").select("stripe_account_id,is_suspended").eq("id", ctx.providerId!).single();
  if (error) throw new Error("Payout account could not be loaded.");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const account = data.stripe_account_id ? await stripe.accounts.retrieve(data.stripe_account_id) : null;
  return { stripe, account, suspended: data.is_suspended };
}

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true, approvedProvider: true });
  if (isAccountError(ctx)) return ctx;
  try {
    const { account } = await stripeAccount(ctx);
    return NextResponse.json({
      connected: !!account, ready: account?.payouts_enabled === true,
      detailsSubmitted: account?.details_submitted === true,
      requirementsDue: account?.requirements?.currently_due?.length ?? 0,
      status: !account ? "Not connected" : account.payouts_enabled ? "Ready for payouts" : "Setup or review needed",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return accountError("Stripe status could not be checked. Please try again.", 503); }
}

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true, approvedProvider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  try {
    const { stripe, account, suspended } = await stripeAccount(ctx);
    if (suspended) return accountError("Contact support while your professional account is suspended.", 403);
    if (!account) return accountError("Contact support to connect your Stripe payout account.", 409);
    let url: string;
    if (account.type === "express" && account.details_submitted) {
      url = (await stripe.accounts.createLoginLink(account.id)).url;
    } else if (account.type === "standard" && account.details_submitted) {
      url = "https://dashboard.stripe.com/";
    } else {
      const origin = request.nextUrl.origin;
      const link = await stripe.accountLinks.create({
        account: account.id, type: account.type === "custom" && account.details_submitted ? "account_update" : "account_onboarding",
        refresh_url: `${origin}/worker/profile#payments`, return_url: `${origin}/worker/profile#payments`,
      });
      url = link.url;
    }
    return NextResponse.json({ url }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return accountError("Stripe settings could not be opened. Please try again.", 503); }
}
