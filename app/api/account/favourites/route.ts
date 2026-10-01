import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";
import type { SupabaseClient } from "@supabase/supabase-js";

async function list(userId: string, admin: SupabaseClient) {
  const { data, error } = await admin.from("customer_favourite_providers")
    .select("provider_id,providers(display_name,photo_url,rating_avg)")
    .eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw new Error("Favourite professionals could not be loaded.");
  return (data ?? []).map((row) => {
    const p = Array.isArray(row.providers) ? row.providers[0] : row.providers;
    return { providerId: row.provider_id, displayName: p?.display_name ?? "Professional", photoUrl: p?.photo_url ?? null, ratingAvg: p?.rating_avg == null ? null : Number(p.rating_avg) };
  });
}

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;
  try { return NextResponse.json({ favourites: await list(ctx.user.id, ctx.admin) }); }
  catch { return accountError("Favourite professionals could not be loaded.", 503); }
}

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (typeof body.providerId !== "string") return accountError("Choose a professional.");
  const { data: provider } = await ctx.admin.from("providers")
    .select("id,vetting_status,is_suspended")
    .eq("id", body.providerId).maybeSingle();
  if (!provider || provider.vetting_status !== "approved" || provider.is_suspended) return accountError("This professional is not currently available.", 404);
  const { error } = await ctx.admin.from("customer_favourite_providers")
    .upsert({ user_id: ctx.user.id, provider_id: provider.id }, { onConflict: "user_id,provider_id" });
  if (error) return accountError("Could not save your favourite.", 503);
  return NextResponse.json({ favourites: await list(ctx.user.id, ctx.admin) });
}

export async function DELETE(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (typeof body.providerId !== "string") return accountError("Choose a professional.");
  const { error } = await ctx.admin.from("customer_favourite_providers")
    .delete().eq("user_id", ctx.user.id).eq("provider_id", body.providerId);
  if (error) return accountError("Could not remove your favourite.", 503);
  return NextResponse.json({ favourites: await list(ctx.user.id, ctx.admin) });
}
