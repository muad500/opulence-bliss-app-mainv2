import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import {
  handymanRpc,
  runHandymanQuoteRecovery,
} from "@/lib/handymanQuoteServer";
import { handymanStripe } from "@/lib/handymanServer";
export async function GET(req: NextRequest) {
  if (!handymanEnabled())
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  const ctx = await adminApi(req);
  if (ctx instanceof NextResponse) return ctx;
  const jobId = req.nextUrl.searchParams.get("job");
  if (jobId) {
    if (!/^[a-f0-9-]{36}$/i.test(jobId))
      return NextResponse.json({ error: "Invalid job." }, { status: 400 });
    const [job, quotes, events, files, operations] = await Promise.all([
      ctx.admin
        .from("handyman_jobs")
        .select(
          "id,task_name,description,address,postcode,status,total_pence,paid_pence,refunded_pence,commission_bps,terms_version,refund_bands",
        )
        .eq("id", jobId)
        .eq("quote_mode", true)
        .maybeSingle(),
      ctx.admin
        .from("handyman_quotes")
        .select(
          "id,provider_id,kind,total_pence,scope,status,earliest_at,duration_minutes,created_at",
        )
        .eq("job_id", jobId)
        .order("created_at")
        .limit(100),
      ctx.admin
        .from("handyman_quote_events")
        .select("actor_id,action,details,created_at")
        .eq("job_id", jobId)
        .order("created_at")
        .limit(100),
      ctx.admin
        .from("handyman_files")
        .select("original_name,storage_path")
        .eq("job_id", jobId)
        .limit(10),
      ctx.admin
        .from("handyman_quote_operations")
        .select(
          "id,kind,amount_pence,status,payment_intent,stripe_ref,last_error,created_at",
        )
        .eq("job_id", jobId)
        .order("created_at")
        .limit(100),
    ]);
    if ([job, quotes, events, files, operations].some((r) => r.error))
      return NextResponse.json(
        { error: "Evidence could not be loaded." },
        { status: 503 },
      );
    if (!job.data)
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const photos = await Promise.all(
      (files.data ?? []).map(async (f) => ({
        name: f.original_name,
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
        job: job.data,
        quotes: quotes.data,
        events: events.data,
        files: photos,
        operations: operations.data,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const [settings, disputes, holds] = await Promise.all([
    ctx.admin
      .from("handyman_quote_settings")
      .select("commission_bps,version")
      .eq("id", true)
      .single(),
    ctx.admin
      .from("handyman_disputes")
      .select(
        "id,job_id,reason,previous_status,created_at,handyman_jobs(task_name,postcode,total_pence,paid_pence,refunded_pence)",
      )
      .eq("status", "open")
      .order("created_at")
      .limit(50),
    ctx.admin
      .from("handyman_quote_operations")
      .select("id,job_id,kind,amount_pence,last_error")
      .eq("status", "held")
      .order("updated_at")
      .limit(50),
  ]);
  if ([settings, disputes, holds].some((r) => r.error))
    return NextResponse.json(
      { error: "Property maintenance desk could not be loaded." },
      { status: 503 },
    );
  return NextResponse.json(
    { settings: settings.data, disputes: disputes.data, holds: holds.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(req: NextRequest) {
  if (!handymanEnabled())
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  const ctx = await adminApi(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const b = await req.json();
    if (b.action === "settings") {
      if (
        !Number.isInteger(b.commissionBps) ||
        b.commissionBps < 0 ||
        b.commissionBps > 5000 ||
        !Number.isInteger(b.version)
      )
        throw new Error("Enter a commission between 0% and 50%.");
      const { data, error } = await ctx.admin
        .from("handyman_quote_settings")
        .update({
          commission_bps: b.commissionBps,
          version: b.version + 1,
          updated_by: ctx.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true)
        .eq("version", b.version)
        .select("version")
        .maybeSingle();
      if (error || !data)
        throw new Error("Settings changed. Refresh before saving again.");
    } else if (b.action === "resolve") {
      if (
        !Number.isInteger(b.refundPence) ||
        b.refundPence < 0 ||
        typeof b.reason !== "string" ||
        b.reason.trim().length < 10
      )
        throw new Error("Enter a valid refund and resolution reason.");
      await handymanRpc(ctx.admin, "handyman_resolve_dispute", {
        p_dispute: b.disputeId,
        p_admin: ctx.user.id,
        p_refund: b.refundPence,
        p_reason: b.reason.trim(),
      });
      await runHandymanQuoteRecovery(ctx.admin, handymanStripe());
    } else if (b.action === "retry") {
      await runHandymanQuoteRecovery(ctx.admin, handymanStripe());
    } else throw new Error("Choose a property maintenance action.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Review could not be saved." },
      { status: 409 },
    );
  }
}
