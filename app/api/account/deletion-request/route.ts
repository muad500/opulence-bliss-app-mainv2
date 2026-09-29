import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError } from "@/lib/accountApi";

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;

  const { data, error } = await ctx.admin
    .from("account_deletion_requests")
    .select("status,requested_at,resolved_at,resolution_note")
    .eq("user_id", ctx.user.id)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return accountError("Deletion request status is unavailable right now.", 503);

  return NextResponse.json({
    request: data ? {
      status: data.status,
      requestedAt: data.requested_at,
      resolvedAt: data.resolved_at,
      note: data.resolution_note,
    } : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
