import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError } from "@/lib/accountApi";

type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: NextRequest, { params }: Context) {
  const ctx = await accountContext(request, { provider: true, approvedProvider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  const { id } = await params;
  const { data, error } = await ctx.admin.from("provider_time_off")
    .delete().eq("id", id).eq("provider_id", ctx.providerId!)
    .select("id").maybeSingle();
  if (error) return accountError("Time off could not be removed.", 503);
  if (!data) return accountError("Time-off period not found.", 404);
  return NextResponse.json({ ok: true });
}
