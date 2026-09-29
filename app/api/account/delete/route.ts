import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (body.confirmation !== "DELETE" && body.confirmation !== "DELETE MY ACCOUNT") {
    return accountError("Confirm that you want to request account deletion.");
  }
  const { data: existing, error: lookupError } = await ctx.admin.from("account_deletion_requests")
    .select("id,requested_at,status").eq("user_id", ctx.user.id)
    .in("status", ["pending", "in_review"]).maybeSingle();
  if (lookupError) return accountError("Deletion requests are unavailable right now.", 503);
  if (existing) return NextResponse.json({ ok: true, status: existing.status, requestedAt: existing.requested_at, message: "Your deletion request is already being reviewed." });
  const { data, error } = await ctx.admin.from("account_deletion_requests")
    .insert({ user_id: ctx.user.id }).select("requested_at,status").single();
  if (error || !data) return accountError("Could not submit the deletion request.", 503);
  return NextResponse.json({ ok: true, status: data.status, requestedAt: data.requested_at, message: "Your deletion request was received. We will review active bookings and legal retention requirements." }, { status: 201 });
}
