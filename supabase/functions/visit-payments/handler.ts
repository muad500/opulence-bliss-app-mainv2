import { timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createVisitBilling } from "../../../lib/visitBillingServer";
import { deliverVisitMatchingNotices } from "../../../lib/visitMatchingNotices";

declare const __VISIT_WORKER_SOURCE_SHA__: string;

const targets = {
  staging: {
    project: "comwdjprdedmsnxtvuuk",
    stripeAccount: "acct_1UKQ4A2NzINBHbzj",
    keyPrefix: "sk_test_",
  },
  production: {
    project: "uiqcsihgqaktpjumyeap",
    stripeAccount: "acct_1UL6n3ILnegr7Mwu",
    keyPrefix: "sk_live_",
  },
} as const;

type Dependencies = {
  env: (name: string) => string | undefined;
  admin: typeof createClient;
  stripe: (key: string) => Stripe;
  tick: (admin: SupabaseClient, stripe: Stripe) => Promise<unknown>;
  notices: (
    admin: SupabaseClient,
    env: Record<string, string | undefined>,
  ) => Promise<unknown>;
};

/** Dedicated machine endpoint. A public/anonymous JWT never authorises billing. */
export function createVisitPaymentHandler(
  overrides: Partial<Dependencies> = {},
) {
  const deps: Dependencies = {
    env: (name) => Deno.env.get(name),
    admin: createClient,
    stripe: (key) =>
      new Stripe(key, {
        httpClient: Stripe.createFetchHttpClient(),
        timeout: 10_000,
        maxNetworkRetries: 1,
      }),
    tick: (admin, stripe) => createVisitBilling(admin, stripe).tick(5),
    notices: deliverVisitMatchingNotices,
    ...overrides,
  };

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return Response.json({ error: "POST required" }, { status: 405 });
    const expected = deps.env("VISIT_PAYMENTS_CRON_SECRET") ?? "";
    const supplied = request.headers.get("x-visit-payments-secret") ?? "";
    const encoder = new TextEncoder();
    const left = encoder.encode(expected);
    const right = encoder.encode(supplied);
    if (
      left.length < 32 ||
      left.length !== right.length ||
      !timingSafeEqual(left, right)
    )
      return Response.json({ error: "Not authorised" }, { status: 401 });

    const mode = deps.env("VISIT_PAYMENTS_MODE");
    const target =
      mode === "staging" || mode === "production" ? targets[mode] : null;
    const url = deps.env("SUPABASE_URL");
    const key = deps.env("VISIT_PAYMENTS_STRIPE_SECRET_KEY");
    const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (
      deps.env("VISIT_PAYMENTS_ENABLED") !== "true" ||
      !target ||
      url !== `https://${target.project}.supabase.co` ||
      !serviceKey ||
      !key?.startsWith(target.keyPrefix)
    )
      return Response.json(
        { error: "Visit scheduler configuration is not ready" },
        { status: 503 },
      );

    try {
      const stripe = deps.stripe(key);
      const account = await stripe.accounts.retrieveCurrent();
      if (account.id !== target.stripeAccount)
        return Response.json(
          { error: "Visit scheduler account mismatch" },
          { status: 503 },
        );
      const admin = deps.admin(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const result = await deps.tick(admin, stripe);
      const notices = await deps.notices(
        admin,
        Object.fromEntries(
          [
            "RESEND_API_KEY",
            "VISIT_PAYMENTS_MODE",
            "STAGING_EMAIL_RECIPIENTS",
            "BOOKING_EMAIL_FROM",
            "EMAIL_FROM",
            "NEXT_PUBLIC_SITE_URL",
            "BOOKING_SMS_ENABLED",
            "TWILIO_ACCOUNT_SID",
            "TWILIO_AUTH_TOKEN",
            "TWILIO_MESSAGING_SERVICE_SID",
            "TWILIO_MONTHLY_BUDGET_GBP",
            "TWILIO_MAX_COST_PER_MESSAGE_GBP",
          ].map((name) => [name, deps.env(name)]),
        ),
      );
      return Response.json({
        ok: true,
        mode,
        source: __VISIT_WORKER_SOURCE_SHA__,
        result,
        notices,
      });
    } catch {
      // Never put provider errors, credentials or customer details in logs.
      console.error(
        "Visit payment scheduler failed; review its operation ledger.",
      );
      return Response.json(
        { error: "Visit scheduler will retry" },
        { status: 503 },
      );
    }
  };
}

Deno.serve(createVisitPaymentHandler());
