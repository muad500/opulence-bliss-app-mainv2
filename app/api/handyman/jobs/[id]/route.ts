import { NextRequest, NextResponse } from "next/server";
import {
  handymanContext,
  handymanStripe,
  isAccountError,
} from "@/lib/handymanServer";
import { readAccountBody, normaliseGbPhone } from "@/lib/accountApi";
import {
  accessibleQuoteJob,
  handymanRpc,
  prepareHandymanQuoteLocations,
  processHandymanQuoteOperation,
} from "@/lib/handymanQuoteServer";
import type { QuoteOperation } from "@/lib/handymanQuoteServer";
import type { AccountContext } from "@/lib/accountApi";
import { calculateCancellationPolicy } from "@/lib/cancellationPolicy";
type Params = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await handymanContext(req);
  if (isAccountError(ctx)) return ctx;
  try {
    const { id } = await params;
    const j = await accessibleQuoteJob(
      ctx.admin,
      id,
      ctx.user.id,
      ctx.providerId,
    );
    if (!j)
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const customer = j.customer_id === ctx.user.id;
    let quotesQuery = ctx.admin
      .from("handyman_quotes")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!customer) quotesQuery = quotesQuery.eq("provider_id", ctx.providerId!);
    let visitsQuery = ctx.admin
      .from("handyman_site_visits")
      .select("*")
      .eq("job_id", id);
    if (!customer) visitsQuery = visitsQuery.eq("provider_id", ctx.providerId!);
    const [quotes, files, visits, review, legal, operations] =
      await Promise.all([
        quotesQuery,
        ctx.admin
          .from("handyman_files")
          .select("id,original_name,storage_path")
          .eq("job_id", id)
          .eq("kind", "photo")
          .limit(10),
        visitsQuery,
        ctx.admin
          .from("handyman_reviews")
          .select("rating,comment,is_public")
          .eq("job_id", id)
          .maybeSingle(),
        ctx.admin
          .from("legal_documents")
          .select("version")
          .eq("slug", "handyman-terms")
          .eq("published", true)
          .maybeSingle(),
        ctx.admin
          .from("handyman_quote_operations")
          .select("id,kind,status,amount_pence,last_error")
          .eq("job_id", id)
          .order("created_at")
          .limit(100),
      ]);
    if ([quotes, files, visits, review, legal, operations].some((r) => r.error))
      throw new Error("Job details could not be loaded.");
    const names = new Map<string, string>();
    const ids = [...new Set((quotes.data ?? []).map((q) => q.provider_id))];
    if (ids.length) {
      const p = await ctx.admin
        .from("providers")
        .select("id,display_name")
        .in("id", ids);
      if (p.error) throw new Error("Professional names could not be loaded.");
      for (const row of p.data ?? []) names.set(row.id, row.display_name);
    }
    const photos = await Promise.all(
      (files.data ?? []).map(async (f) => ({
        id: f.id,
        original_name: f.original_name,
        url:
          (
            await ctx.admin.storage
              .from("handyman-job-files")
              .createSignedUrl(f.storage_path, 600)
          ).data?.signedUrl ?? null,
      })),
    );
    return NextResponse.json(
      {
        job: {
          ...j,
          payout_account_id: null,
          address:
            customer || j.provider_id === ctx.providerId ? j.address : "",
          customer_id: customer ? j.customer_id : "",
          refund_bands: undefined,
        },
        role: customer ? "customer" : "professional",
        quotes: (quotes.data ?? []).map((q) => ({
          ...q,
          display_name: names.get(q.provider_id) ?? "Professional",
        })),
        files: photos,
        visits: visits.data,
        review: review.data,
        termsVersion: legal.data?.version ?? null,
        cancellationPreview:
          j.scheduled_at && j.refund_bands
            ? calculateCancellationPolicy(
                j.scheduled_at,
                (j.paid_pence - j.refunded_pence) / 100,
                new Date(),
                j.refund_bands,
              ).explanation
            : "Cancel this unbooked request? No cancellation charge applies.",
        operations:
          customer || j.provider_id === ctx.providerId ? operations.data : [],
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Job details could not be loaded." },
      { status: 503 },
    );
  }
}
async function jobOperations(ctx: AccountContext, id: string) {
  const { data, error } = await ctx.admin
    .from("handyman_quote_operations")
    .select("id,kind,status")
    .eq("job_id", id)
    .in("status", ["queued", "processing", "pending", "held"])
    .order("created_at")
    .limit(40);
  if (error) throw new Error("Payment recovery could not be loaded.");
  const stripe = handymanStripe();
  for (const op of data ?? []) {
    try {
      await processHandymanQuoteOperation(ctx.admin, stripe, op.id);
    } catch {
      /* Durable queue and admin desk retain the failure. */
    }
  }
  await handymanRpc(ctx.admin, "handyman_quote_maintenance");
}
async function pay(ctx: AccountContext, id: string, origin: string) {
  for (let retry = 0; retry < 2; retry++) {
    const { data, error } = await ctx.admin
      .from("handyman_quote_operations")
      .select("*")
      .eq("job_id", id)
      .eq("kind", "charge")
      .in("status", ["queued", "processing", "pending", "held"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Checkout could not be loaded.");
    if (data) {
      const result = await processHandymanQuoteOperation(
        ctx.admin,
        handymanStripe(),
        (data as QuoteOperation).id,
        { user: ctx.user, origin },
      );
      if (!("expired" in result)) return result;
    }
    await handymanRpc(ctx.admin, "handyman_quote_command", {
      p_job: id,
      p_user: ctx.user.id,
      p_action: "retry_payment",
      p_data: { requestKey: crypto.randomUUID() },
    });
  }
  throw new Error("Refresh the job to retry checkout.");
}
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await handymanContext(req, true);
  if (isAccountError(ctx)) return ctx;
  const b = await readAccountBody(req);
  if (b instanceof NextResponse) return b;
  try {
    const { id } = await params;
    const job = await accessibleQuoteJob(
      ctx.admin,
      id,
      ctx.user.id,
      ctx.providerId,
    );
    if (!job)
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const customer = job.customer_id === ctx.user.id,
      action = String(b.action);
    if (
      [
        "pay",
        "sync",
        "accept",
        "accept_visit",
        "accept_revision",
        "publish",
        "review",
      ].includes(action) &&
      !customer
    )
      return NextResponse.json(
        { error: "Customer approval is required." },
        { status: 403 },
      );
    if (action === "pay")
      return NextResponse.json(await pay(ctx, id, req.nextUrl.origin));
    if (action === "sync") {
      await jobOperations(ctx, id);
      return NextResponse.json({ ok: true });
    }
    if (action === "review") {
      if (
        job.status !== "completed" ||
        !Number.isInteger(b.rating) ||
        Number(b.rating) < 1 ||
        Number(b.rating) > 5 ||
        typeof b.comment !== "string" ||
        b.comment.length > 2000 ||
        typeof b.isPublic !== "boolean"
      )
        throw new Error("Review a completed job with a valid rating.");
      const { error } = await ctx.admin.from("handyman_reviews").upsert({
        job_id: id,
        rating: b.rating,
        comment: b.comment.trim() || null,
        is_public: b.isPublic,
        reviewed_at: new Date().toISOString(),
      });
      if (error) throw new Error("Review could not be saved.");
      return NextResponse.json({ ok: true });
    }
    if (action === "accept") {
      const { data: profile } = await ctx.admin
        .from("profiles")
        .select("phone")
        .eq("id", ctx.user.id)
        .single();
      if (!normaliseGbPhone(profile?.phone))
        throw new Error(
          "Save a valid UK phone number in My profile before accepting a quote.",
        );
    }
    if (action === "publish")
      await prepareHandymanQuoteLocations(ctx.admin, id);
    await handymanRpc(ctx.admin, "handyman_quote_command", {
      p_job: id,
      p_user: ctx.user.id,
      p_action: action,
      p_data: b,
    });
    await handymanRpc(ctx.admin, "handyman_quote_maintenance");
    if (["accept", "accept_revision"].includes(action)) {
      const { data } = await ctx.admin
        .from("handyman_quote_operations")
        .select("id")
        .eq("job_id", id)
        .eq("kind", "charge")
        .in("status", ["queued", "processing", "pending", "held"])
        .limit(1)
        .maybeSingle();
      if (data) {
        const result = await pay(ctx, id, req.nextUrl.origin);
        return NextResponse.json(result);
      }
      await jobOperations(ctx, id);
    }
    if (["cancel", "confirm"].includes(action)) await jobOperations(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The job needs a retry or support review.",
      },
      { status: 409 },
    );
  }
}
