import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { csvCell, hmrcDates } from "@/lib/workerOperations";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  let dates;
  try {
    dates = hmrcDates(
      request.nextUrl.searchParams.get("from"),
      request.nextUrl.searchParams.get("to"),
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
  const audit = await ctx.admin
    .from("professional_export_audits")
    .insert({
      actor_id: ctx.user.id,
      starts_on: dates.from,
      ends_before: dates.to,
      professional_count: -1,
    })
    .select("id")
    .single();
  if (audit.error)
    return NextResponse.json(
      { error: "Export audit could not be saved." },
      { status: 503 },
    );
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await ctx.admin.rpc("professional_earnings_export", {
      p_from: dates.from,
      p_to: dates.to,
      p_after: after,
    });
    if (page.error || !Array.isArray(page.data))
      return NextResponse.json(
        { error: "Earnings could not be exported. Try again." },
        { status: 503 },
      );
    rows.push(...page.data);
    if (page.data.length < 500) break;
    after = page.data.at(-1).provider_id;
  }
  const saved = await ctx.admin
    .from("professional_export_audits")
    .update({ professional_count: rows.length })
    .eq("id", audit.data.id)
    .select("id")
    .single();
  if (saved.error || !saved.data)
    return NextResponse.json(
      { error: "Export audit could not be completed." },
      { status: 503 },
    );
  const headings = [
    "Professional ID",
    "Legal name",
    "Address",
    "Postcode",
    "Date of birth",
    "UTR",
    "Net paid GBP",
    "Transfers",
    "Missing details",
    "Period from",
    "Period before",
    "Currency",
  ];
  const csv = [
    headings,
    ...rows.map((row) => [
      row.provider_id,
      row.legal_name,
      row.address,
      row.postcode,
      row.date_of_birth,
      row.utr_number,
      (Number(row.net_paid_pence) / 100).toFixed(2),
      row.transfer_count,
      row.missing_details,
      dates.from,
      dates.to,
      "GBP",
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="professional-earnings-${dates.from}-${dates.to}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
