import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateBillingCustomer } from "./accountBilling";
import { handymanEnabled } from "./handymanMarketplace";
import type { HandymanQuoteJob } from "./handymanQuotes";

export type QuoteOperation = {
  id: string;
  job_id: string;
  quote_id: string | null;
  source_id: string | null;
  kind: "charge" | "refund" | "transfer" | "reversal";
  amount_pence: number;
  status: string;
  operation_key: string;
  parameters: Stripe.Checkout.SessionCreateParams | null;
  session_id: string | null;
  payment_intent: string | null;
  charge_id: string | null;
  stripe_ref: string | null;
  claim_token: string | null;
  last_error: string | null;
};
export async function handymanRpc<T>(
  admin: SupabaseClient,
  name: string,
  params: Record<string, unknown> = {},
) {
  const { data, error } = await admin.rpc(name, params);
  if (error)
    throw new Error(
      error.message || "Property maintenance could not be updated.",
    );
  return data as T;
}
export async function loadQuoteJob(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from("handyman_jobs")
    .select("*")
    .eq("id", id)
    .eq("quote_mode", true)
    .maybeSingle();
  if (error) throw new Error("Job could not be loaded.");
  return data as HandymanQuoteJob | null;
}
/** Verified Stripe disputes, including those opened after a completed payout. */
export async function reviewHandymanQuoteDispute(
  admin: SupabaseClient,
  chargeId: string,
) {
  if (!handymanEnabled()) return;
  const { data, error } = await admin
    .from("handyman_quote_operations")
    .select("job_id")
    .eq("kind", "charge")
    .eq("charge_id", chargeId)
    .eq("status", "succeeded")
    .maybeSingle();
  if (error) throw new Error("Funding record could not be checked.");
  if (data)
    await handymanRpc(admin, "handyman_stripe_review", {
      p_job: data.job_id,
      p_charge: chargeId,
      p_reason:
        "Stripe card dispute opened. Review the card dispute and job evidence before any further settlement.",
    });
}
export async function accessibleQuoteJob(
  admin: SupabaseClient,
  id: string,
  user: string,
  provider: string | null,
) {
  const job = await loadQuoteJob(admin, id);
  if (!job) return null;
  if (job.customer_id === user || (provider && job.provider_id === provider))
    return job;
  if (!provider || job.status !== "posted") return null;
  const { data, error } = await admin
    .from("handyman_invitations")
    .select("provider_id,notified_at,outcome")
    .eq("job_id", id)
    .eq("provider_id", provider)
    .maybeSingle();
  if (error) throw new Error("Invitation could not be loaded.");
  if (!data?.notified_at || !["offered", "quoted"].includes(data.outcome))
    return null;
  return (await handymanRpc<boolean>(admin, "handyman_quote_eligible", {
    p_provider: provider,
    p_job: id,
  }))
    ? job
    : null;
}

async function operation(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from("handyman_quote_operations")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Payment operation could not be loaded.");
  return data as QuoteOperation;
}
async function acknowledge(
  admin: SupabaseClient,
  op: QuoteOperation,
  status: string,
  refs: { ref?: string; intent?: string; charge?: string; error?: string } = {},
) {
  await handymanRpc(admin, "handyman_record_operation", {
    p_id: op.id,
    p_token: op.claim_token,
    p_status: status,
    p_ref: refs.ref ?? null,
    p_intent: refs.intent ?? null,
    p_charge: refs.charge ?? null,
    p_error: refs.error ?? null,
  });
}
async function verifyQuoteFunding(
  admin: SupabaseClient,
  stripe: Stripe,
  job: HandymanQuoteJob,
  source: QuoteOperation,
) {
  if (!source.charge_id || !source.payment_intent)
    throw new Error("Funding charge is missing.");
  const charge = await stripe.charges.retrieve(source.charge_id);
  const fundingIntent =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  const { data: refunds, error: refundError } = await admin
    .from("handyman_quote_operations")
    .select("amount_pence")
    .eq("source_id", source.id)
    .eq("kind", "refund")
    .eq("status", "succeeded");
  const expectedRefund = (refunds ?? []).reduce(
    (sum, row) => sum + row.amount_pence,
    0,
  );
  if (refundError) throw new Error("Funding refunds could not be reconciled.");
  if (
    charge.livemode !== false ||
    !charge.paid ||
    !charge.captured ||
    charge.currency !== "gbp" ||
    fundingIntent !== source.payment_intent ||
    charge.amount !== source.amount_pence
  )
    throw new Error("Funding charge does not match the settled quote.");
  if (charge.disputed || charge.amount_refunded !== expectedRefund) {
    await handymanRpc(admin, "handyman_stripe_review", {
      p_job: job.id,
      p_charge: source.charge_id,
      p_reason: charge.disputed
        ? "Stripe card dispute requires review before further settlement."
        : "Stripe refund history differs from the quote ledger. Reconcile it before moving further money.",
    });
    throw new Error("Funding payment needs admin review.");
  }
}
async function findSession(stripe: Stripe, op: QuoteOperation) {
  if (op.session_id) return stripe.checkout.sessions.retrieve(op.session_id);
  const customer = op.parameters?.customer;
  if (typeof customer !== "string")
    throw new Error("Checkout needs reconciliation.");
  let count = 0,
    found: Stripe.Checkout.Session | null = null;
  for await (const s of stripe.checkout.sessions.list({
    customer,
    limit: 100,
  })) {
    if (s.metadata?.handyman_operation === op.id) {
      if (found) throw new Error("Multiple checkouts need support review.");
      found = s;
    }
    if (++count >= 1000)
      throw new Error("Checkout history needs support review.");
  }
  return found;
}
function verifyQuotePayment(
  job: HandymanQuoteJob,
  op: QuoteOperation,
  s: Stripe.Checkout.Session,
  pi: Stripe.PaymentIntent,
) {
  const intent =
    typeof s.payment_intent === "string"
      ? s.payment_intent
      : s.payment_intent?.id;
  const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
  const piCustomer =
    typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  if (
    s.status !== "complete" ||
    s.livemode !== false ||
    pi.livemode !== false ||
    s.payment_status !== "paid" ||
    s.mode !== "payment" ||
    s.client_reference_id !== job.customer_id ||
    s.metadata?.kind !== "handyman_quote" ||
    s.metadata?.job_id !== job.id ||
    s.metadata?.handyman_operation !== op.id ||
    intent !== pi.id ||
    customer !== op.parameters?.customer ||
    customer !== piCustomer ||
    pi.status !== "succeeded" ||
    pi.amount !== op.amount_pence ||
    pi.amount_received !== op.amount_pence ||
    pi.currency !== "gbp" ||
    pi.transfer_group !== "handyman_quote_" + job.id ||
    pi.metadata.kind !== "handyman_quote" ||
    pi.metadata.job_id !== job.id ||
    pi.metadata.customer_id !== job.customer_id ||
    pi.metadata.handyman_operation !== op.id ||
    pi.metadata.quote_id !== op.quote_id ||
    pi.capture_method === "manual" ||
    pi.transfer_data?.destination ||
    pi.application_fee_amount ||
    !pi.latest_charge
  )
    throw new Error("Payment does not match the accepted fixed quote.");
}

/** Called only from the verified existing Stripe webhook or authenticated sync.
 * Browser redirects and browser-supplied amounts are never payment evidence. */
export async function finalizeHandymanQuoteCheckout(
  admin: SupabaseClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  pi: Stripe.PaymentIntent,
) {
  if (!handymanEnabled()) return;
  const id = session.metadata?.handyman_operation;
  if (!id) throw new Error("Payment operation is missing.");
  const current = await operation(admin, id),
    job = await loadQuoteJob(admin, current.job_id);
  if (!job || current.kind !== "charge")
    throw new Error("Unknown quote payment.");
  verifyQuotePayment(job, current, session, pi);
  if (current.status === "succeeded") {
    if (current.session_id !== session.id || current.payment_intent !== pi.id)
      throw new Error("Payment history changed.");
    return;
  }
  if (
    current.status === "expired" ||
    (current.session_id && current.session_id !== session.id)
  )
    throw new Error("Expired or replaced checkout needs review.");
  // A concurrent webhook/recovery worker retries safely after the lease expires.
  const claimed = await handymanRpc<QuoteOperation>(
    admin,
    "handyman_claim_operation",
    { p_id: id },
  );
  await acknowledge(admin, claimed, "succeeded", {
    ref: session.id,
    intent: pi.id,
    charge:
      typeof pi.latest_charge === "string"
        ? pi.latest_charge
        : pi.latest_charge!.id,
  });
}

async function checkoutParameters(
  stripe: Stripe,
  admin: SupabaseClient,
  j: HandymanQuoteJob,
  op: QuoteOperation,
  user: { id: string; email?: string },
  origin: string,
) {
  if (j.customer_id !== user.id || !j.provider_id || !j.payout_account_id)
    throw new Error(
      "Customer approval and an assigned payout account are required.",
    );
  const { data, error } = await admin
    .from("providers")
    .select("stripe_account_id,profile_id")
    .eq("id", j.provider_id)
    .single();
  if (
    error ||
    data?.profile_id === user.id ||
    data?.stripe_account_id !== j.payout_account_id
  )
    throw new Error("Provider payout account is not configured");
  const account = await stripe.accounts.retrieve(j.payout_account_id);
  if (account.deleted || account.capabilities?.transfers !== "active")
    throw new Error("Provider payout account is not configured");
  const customer = await getOrCreateBillingCustomer(stripe, user);
  const metadata = {
    kind: "handyman_quote",
    job_id: j.id,
    quote_id: op.quote_id!,
    handyman_operation: op.id,
    customer_id: user.id,
  };
  return {
    mode: "payment",
    customer,
    client_reference_id: user.id,
    payment_method_types: ["card"],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    metadata,
    payment_intent_data: {
      capture_method: "automatic",
      transfer_group: "handyman_quote_" + j.id,
      metadata,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: op.amount_pence,
          product_data: {
            name: op.operation_key.startsWith("accept:")
              ? "Property maintenance — accepted fixed quote"
              : "Property maintenance — approved scope difference",
            description:
              "Fixed total including materials. No hourly billing or added VAT.",
          },
        },
      },
    ],
    success_url: origin + "/handyman/jobs/" + j.id + "?checkout=complete",
    cancel_url: origin + "/handyman/jobs/" + j.id,
  } satisfies Stripe.Checkout.SessionCreateParams;
}

export async function processHandymanQuoteOperation(
  admin: SupabaseClient,
  stripe: Stripe,
  id: string,
  checkout?: { user: { id: string; email?: string }; origin: string },
) {
  if (!handymanEnabled()) throw new Error("Marketplace is disabled.");
  const current = await operation(admin, id),
    job = await loadQuoteJob(admin, current.job_id);
  if (!job) throw new Error("Quote job not found.");
  if (["succeeded", "expired"].includes(current.status)) return { ok: true };
  if (
    current.kind === "charge" &&
    !current.parameters &&
    !checkout &&
    !["cancel_pending", "disputed"].includes(job.status)
  )
    return { ok: true };
  const parameters =
    current.kind === "charge" &&
    !current.parameters &&
    checkout &&
    !["cancel_pending", "disputed"].includes(job.status)
      ? await checkoutParameters(
          stripe,
          admin,
          job,
          current,
          checkout.user,
          checkout.origin,
        )
      : null;
  const op = await handymanRpc<QuoteOperation>(
    admin,
    "handyman_claim_operation",
    {
      p_id: id,
      p_parameters: parameters,
      p_reconcile_only:
        current.kind === "transfer" &&
        ["held", "pending", "processing"].includes(current.status),
    },
  );
  if (op.status === "held")
    throw new Error(op.last_error ?? "Payout is held for admin review.");
  if (["succeeded", "expired"].includes(op.status)) return { ok: true };
  try {
    if (op.kind === "charge") {
      const latest = await loadQuoteJob(admin, op.job_id);
      if (!latest) throw new Error("Job not found.");
      if (!op.parameters) {
        if (["cancel_pending", "disputed"].includes(latest.status)) {
          await acknowledge(admin, op, "expired");
          return { ok: true };
        }
        throw new Error("Checkout is not ready.");
      }
      let session = await findSession(stripe, op);
      if (
        !session &&
        !["cancel_pending", "disputed"].includes(latest.status) &&
        checkout
      ) {
        // The saved create parameters never change under an idempotency key.
        if (
          !op.parameters.expires_at ||
          op.parameters.expires_at < Date.now() / 1000 + 1800
        ) {
          await acknowledge(admin, op, "expired");
          return { expired: true };
        }
        session = await stripe.checkout.sessions.create(op.parameters, {
          idempotencyKey: "handyman-quote-checkout:" + op.id,
        });
      }
      if (!session) {
        if (
          ["cancel_pending", "disputed"].includes(latest.status) ||
          (op.parameters.expires_at ?? Infinity) < Date.now() / 1000
        )
          await acknowledge(admin, op, "expired");
        else await acknowledge(admin, op, "pending");
        return { ok: true };
      }
      if (
        session.status === "open" &&
        ["cancel_pending", "disputed"].includes(latest.status)
      )
        session = await stripe.checkout.sessions.expire(session.id);
      if (session.status === "expired") {
        await acknowledge(admin, op, "expired");
        return { expired: true };
      }
      if (session.status === "complete" && session.payment_intent) {
        const pi = await stripe.paymentIntents.retrieve(
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent.id,
        );
        verifyQuotePayment(latest, op, session, pi);
        await acknowledge(admin, op, "succeeded", {
          ref: session.id,
          intent: pi.id,
          charge:
            typeof pi.latest_charge === "string"
              ? pi.latest_charge
              : pi.latest_charge!.id,
        });
        return { paid: true };
      }
      await acknowledge(admin, op, "pending", { ref: session.id });
      return { url: checkout ? session.url : null };
    }
    const source = op.source_id ? await operation(admin, op.source_id) : null;
    if (!source || source.status !== "succeeded")
      throw new Error("Funding operation has not settled.");
    if (op.kind === "refund") {
      if (!source.payment_intent) throw new Error("Refund funding is missing.");
      let found: Stripe.Refund | undefined;
      for await (const r of stripe.refunds.list({
        payment_intent: source.payment_intent,
        limit: 100,
      })) {
        if (r.metadata?.handyman_operation === op.id) {
          if (found) throw new Error("Duplicate refunds need review.");
          found = r;
        }
      }
      if (!found) await verifyQuoteFunding(admin, stripe, job, source);
      const refund =
        found ??
        (await stripe.refunds.create(
          {
            payment_intent: source.payment_intent,
            amount: op.amount_pence,
            metadata: { handyman_operation: op.id, job_id: job.id },
          },
          { idempotencyKey: "handyman-quote-refund:" + op.id },
        ));
      const intent =
        typeof refund.payment_intent === "string"
          ? refund.payment_intent
          : refund.payment_intent?.id;
      if (
        refund.amount !== op.amount_pence ||
        refund.currency !== "gbp" ||
        intent !== source.payment_intent ||
        refund.metadata?.handyman_operation !== op.id
      )
        throw new Error("Refund history does not match.");
      if (refund.status === "succeeded")
        await acknowledge(admin, op, "succeeded", { ref: refund.id });
      else
        await acknowledge(
          admin,
          op,
          refund.status === "pending" ? "pending" : "held",
          { error: "Refund needs confirmation or admin review." },
        );
      return { ok: true };
    }
    if (op.kind === "reversal") {
      if (!source.stripe_ref)
        throw new Error("Prior payout reference is missing.");
      let found: Stripe.TransferReversal | undefined;
      for await (const r of stripe.transfers.listReversals(source.stripe_ref, {
        limit: 100,
      })) {
        if (r.metadata?.handyman_operation === op.id) {
          if (found) throw new Error("Duplicate reversals need review.");
          found = r;
        }
      }
      const reversal =
        found ??
        (await stripe.transfers.createReversal(
          source.stripe_ref,
          {
            amount: op.amount_pence,
            metadata: { handyman_operation: op.id, job_id: job.id },
          },
          { idempotencyKey: "handyman-quote-reversal:" + op.id },
        ));
      if (
        reversal.amount !== op.amount_pence ||
        reversal.metadata?.handyman_operation !== op.id
      )
        throw new Error("Reversal does not match.");
      await acknowledge(admin, op, "succeeded", { ref: reversal.id });
      return { ok: true };
    }
    if (!job.payout_account_id || !source.charge_id)
      throw new Error("Provider payout account is not configured");
    let found: Stripe.Transfer | undefined;
    for await (const t of stripe.transfers.list({
      transfer_group: "handyman_quote_" + job.id,
      limit: 100,
    })) {
      if (t.metadata.handyman_operation === op.id) {
        if (found) throw new Error("Duplicate payouts need review.");
        found = t;
      }
    }
    if (!found) {
      if (job.status === "disputed")
        throw new Error(
          "Reconcile the previous payout outcome with Stripe before resolving this dispute.",
        );
      await verifyQuoteFunding(admin, stripe, job, source);
      const { data: provider, error } = await admin
        .from("providers")
        .select("stripe_account_id,profile_id")
        .eq("id", job.provider_id!)
        .single();
      if (
        error ||
        provider?.profile_id === job.customer_id ||
        provider?.stripe_account_id !== job.payout_account_id
      )
        throw new Error("Provider payout account is not configured");
      const account = await stripe.accounts.retrieve(job.payout_account_id);
      if (account.deleted || account.capabilities?.transfers !== "active")
        throw new Error("Provider payout account is not configured");
    }
    const transfer =
      found ??
      (await stripe.transfers.create(
        {
          amount: op.amount_pence,
          currency: "gbp",
          destination: job.payout_account_id,
          source_transaction: source.charge_id,
          transfer_group: "handyman_quote_" + job.id,
          metadata: {
            handyman_operation: op.id,
            job_id: job.id,
            provider_id: job.provider_id!,
          },
        },
        { idempotencyKey: "handyman-quote-payout:" + op.id },
      ));
    const destination =
      typeof transfer.destination === "string"
        ? transfer.destination
        : transfer.destination?.id;
    const charge =
      typeof transfer.source_transaction === "string"
        ? transfer.source_transaction
        : transfer.source_transaction?.id;
    if (
      transfer.amount !== op.amount_pence ||
      transfer.currency !== "gbp" ||
      destination !== job.payout_account_id ||
      charge !== source.charge_id ||
      transfer.metadata.handyman_operation !== op.id ||
      transfer.reversed ||
      transfer.amount_reversed
    )
      throw new Error("Payout history needs review.");
    await acknowledge(admin, op, "succeeded", { ref: transfer.id });
    return { ok: true };
  } catch (error) {
    // Preserve unknown outcomes for reconciliation, never invent a second key.
    await acknowledge(admin, op, "held", {
      error:
        error instanceof Error &&
        error.message === "Provider payout account is not configured"
          ? error.message
          : "Payment operation needs a retry or admin review.",
    }).catch(() => {});
    throw error;
  }
}

export async function runHandymanQuoteRecovery(
  admin: SupabaseClient,
  stripe: Stripe,
) {
  if (!handymanEnabled()) return { checked: 0, failed: 0 };
  await handymanRpc(admin, "handyman_quote_maintenance");
  const { data, error } = await admin
    .from("handyman_quote_operations")
    .select("id,kind")
    .in("status", ["queued", "processing", "pending", "held"])
    .order("updated_at")
    .limit(40);
  if (error) throw new Error("Quote recovery could not be loaded.");
  let failed = 0;
  // Reversals must finish before their dependent refunds, then remaining payouts.
  const order = ["charge", "reversal", "refund", "transfer"];
  for (const op of (data ?? []).sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  )) {
    try {
      await processHandymanQuoteOperation(admin, stripe, op.id);
    } catch {
      failed++;
    }
  }
  await handymanRpc(admin, "handyman_quote_maintenance");
  return { checked: data?.length ?? 0, failed };
}

/** Geocode public postcode districts only, matching cleaning's privacy model. */
export async function prepareHandymanQuoteLocations(
  admin: SupabaseClient,
  id: string,
) {
  const { data: j } = await admin
    .from("handyman_jobs")
    .select("postcode")
    .eq("id", id)
    .single();
  const { data: providers } = await admin
    .from("provider_profile_settings")
    .select("home_postcode")
    .limit(500);
  const outcode = (v: string | null) =>
    v
      ?.trim()
      .toUpperCase()
      .match(/^([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?$/)?.[1];
  const districts = [
    ...new Set(
      [j?.postcode, ...(providers ?? []).map((p) => p.home_postcode)]
        .map(outcode)
        .filter((v): v is string => !!v),
    ),
  ].slice(0, 60);
  await Promise.all(
    districts.map(async (code) => {
      try {
        const { data: cached } = await admin
          .from("offer_geo_outcodes")
          .select("outcode")
          .eq("outcode", code)
          .maybeSingle();
        if (cached) return;
        const response = await fetch(
          "https://api.postcodes.io/outcodes/" + code,
          { signal: AbortSignal.timeout(2500) },
        );
        if (!response.ok) return;
        const { result } = await response.json();
        if (
          Number.isFinite(result?.latitude) &&
          Number.isFinite(result?.longitude)
        )
          await admin.from("offer_geo_outcodes").upsert({
            outcode: code,
            latitude: result.latitude,
            longitude: result.longitude,
          });
      } catch {
        /* Missing coordinates remove distance points, never eligibility. */
      }
    }),
  );
}
