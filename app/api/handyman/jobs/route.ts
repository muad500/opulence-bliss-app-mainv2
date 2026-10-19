import { NextRequest, NextResponse } from "next/server";
import { handymanContext, isAccountError } from "@/lib/handymanServer";
import { readAccountBody } from "@/lib/accountApi";
import { handymanPostcode, handymanPreferredDates } from "@/lib/handymanQuotes";
import { regulatedHandymanDescription } from "@/lib/handymanMarketplace";
import { handymanRpc } from "@/lib/handymanQuoteServer";
import type { HandymanQuoteJob } from "@/lib/handymanQuotes";
export async function GET(req: NextRequest) {
  const ctx = await handymanContext(req);
  if (isAccountError(ctx)) return ctx;
  const { data, error } = await ctx.admin
    .from("handyman_jobs")
    .select(
      "id,task_name,description,postcode,preferred_dates,status,scheduled_at,total_pence,created_at",
    )
    .eq("quote_mode", true)
    .eq("customer_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  return NextResponse.json(
    error ? { error: "Jobs could not be loaded." } : { jobs: data },
    {
      status: error ? 503 : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
export async function POST(req: NextRequest) {
  const ctx = await handymanContext(req, true);
  if (isAccountError(ctx)) return ctx;
  const b = await readAccountBody(req);
  if (b instanceof NextResponse) return b;
  try {
    if (
      Object.keys(b).some(
        (key) =>
          ![
            "requestKey",
            "task",
            "description",
            "postcode",
            "preferredDates",
          ].includes(key),
      ) ||
      typeof b.requestKey !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(b.requestKey) ||
      typeof b.task !== "string" ||
      typeof b.description !== "string" ||
      b.description.trim().length < 10 ||
      b.description.length > 2000 ||
      regulatedHandymanDescription(b.description)
    )
      throw new Error(
        "Post the job details without a price. Gas, electrical and structural work are not offered.",
      );
    const job = await handymanRpc<HandymanQuoteJob>(
      ctx.admin,
      "handyman_post_job",
      {
        p_user: ctx.user.id,
        p_key: b.requestKey,
        p_task: b.task,
        p_description: b.description.trim(),
        p_postcode: handymanPostcode(b.postcode),
        p_dates: handymanPreferredDates(b.preferredDates),
      },
    );
    return NextResponse.json(
      { jobId: job.id, status: job.status },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Check the job details.",
      },
      { status: 400 },
    );
  }
}
