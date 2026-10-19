import { NextRequest, NextResponse } from "next/server";
import { handymanContext, isAccountError } from "@/lib/handymanServer";
import { handymanRpc } from "@/lib/handymanQuoteServer";
export async function GET(req: NextRequest) {
  const ctx = await handymanContext(req);
  if (isAccountError(ctx)) return ctx;
  if (!ctx.providerId || !ctx.professionalApproved)
    return NextResponse.json(
      { error: "Approved professional required." },
      { status: 403 },
    );
  const { data, error } = await ctx.admin
    .from("handyman_invitations")
    .select("job_id,notified_at,outcome")
    .eq("provider_id", ctx.providerId)
    .in("outcome", ["offered", "quoted"])
    .not("notified_at", "is", null)
    .order("notified_at", { ascending: false })
    .limit(100);
  if (error)
    return NextResponse.json(
      { error: "Invitations could not be loaded." },
      { status: 503 },
    );
  const jobs: {
    id: string;
    task_name: string;
    description: string;
    postcode: string;
    preferred_dates: string[];
    status: string;
    created_at: string;
  }[] = [];
  for (const invitation of data ?? []) {
    if (
      !(await handymanRpc(ctx.admin, "handyman_quote_eligible", {
        p_provider: ctx.providerId,
        p_job: invitation.job_id,
      }))
    )
      continue;
    const { data: job, error: lookup } = await ctx.admin
      .from("handyman_jobs")
      .select(
        "id,task_name,description,postcode,preferred_dates,status,created_at",
      )
      .eq("id", invitation.job_id)
      .eq("status", "posted")
      .maybeSingle();
    if (lookup)
      return NextResponse.json(
        { error: "Invitations could not be loaded." },
        { status: 503 },
      );
    if (job) jobs.push(job);
  }
  return NextResponse.json(
    { jobs },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
