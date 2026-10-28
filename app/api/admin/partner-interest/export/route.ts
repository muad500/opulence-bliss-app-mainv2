import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { csvCell } from "@/lib/workerOperations";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const audit = await ctx.admin
    .from("partner_interest_export_audits")
    .insert({ actor_id: ctx.user.id })
    .select("id")
    .single();
  if (audit.error || !audit.data)
    return NextResponse.json(
      { error: "Export access could not be recorded." },
      { status: 503 },
    );
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (;;) {
    let query = ctx.admin
      .from("partner_interests")
      .select(
        "id,created_at,full_name,email,phone,description,consent_at,consent_wording,consent_ip,partner_registered_at",
      )
      .order("id", { ascending: true })
      .limit(500);
    if (after) query = query.gt("id", after);
    const page = await query;
    if (page.error || !Array.isArray(page.data))
      return NextResponse.json(
        { error: "The interest list could not be exported." },
        { status: 503 },
      );
    rows.push(...page.data);
    if (page.data.length < 500) break;
    after = page.data.at(-1)!.id;
  }
  const complete = await ctx.admin
    .from("partner_interest_export_audits")
    .update({ row_count: rows.length, completed_at: new Date().toISOString() })
    .eq("id", audit.data.id)
    .select("id")
    .single();
  if (complete.error || !complete.data)
    return NextResponse.json(
      { error: "Export completion could not be recorded." },
      { status: 503 },
    );
  const headings = [
    "Interest ID",
    "Interest date UTC",
    "Full name",
    "Email",
    "Phone",
    "Description",
    "Consent time UTC",
    "Consent wording",
    "Consent IP",
    "Partner registered UTC",
  ];
  const csv = [
    headings,
    ...rows.map((row) => [
      row.id,
      row.created_at,
      row.full_name,
      row.email,
      row.phone,
      row.description,
      row.consent_at,
      row.consent_wording,
      row.consent_ip,
      row.partner_registered_at,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="partner-interest-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
