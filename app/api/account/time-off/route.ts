import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return accountError("Choose valid start and end dates.");
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start || start < new Date(Date.now() - 86400000) || end.getTime() - start.getTime() > 366 * 86400000) {
    return accountError("Choose a future time-off period of up to one year.");
  }
  if (typeof body.note !== "undefined" && (typeof body.note !== "string" || body.note.length > 200)) return accountError("Keep the note under 200 characters.");
  const { data, error } = await ctx.admin.from("provider_time_off").insert({
    provider_id: ctx.providerId,
    starts_at: start.toISOString(),
    ends_at: new Date(end.getTime() + 86400000).toISOString(),
    note: String(body.note ?? "").trim() || null,
  }).select("id,starts_at,ends_at,note").single();
  if (error || !data) return accountError("Time off could not be saved.", 503);
  return NextResponse.json({ timeOff: { id: data.id, startDate, endDate, note: data.note ?? "" } }, { status: 201 });
}
