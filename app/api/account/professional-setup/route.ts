import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  accountError,
  isAccountError,
  normaliseGbPhone,
  readAccountBody,
} from "@/lib/accountApi";
export async function GET(request: NextRequest) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;
  const row = await ctx.admin
    .from("professional_setup_invitations")
    .select("setup_completed_at")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (row.error) return accountError("Setup status could not be loaded.", 503);
  return NextResponse.json(
    { pending: !!row.data && !row.data.setup_completed_at },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  const row = await ctx.admin
    .from("professional_setup_invitations")
    .select("setup_completed_at")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (
    !row.data ||
    row.data.setup_completed_at ||
    ctx.user.user_metadata?.setup_password_set
  )
    return accountError(
      "Use account settings to change existing details.",
      409,
    );
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128 ||
    !/[a-z]/.test(body.password) ||
    !/[A-Z]/.test(body.password) ||
    !/\d/.test(body.password)
  )
    return accountError(
      "Use a password of 12–128 characters with uppercase, lowercase and a number.",
    );
  let phone;
  try {
    phone = normaliseGbPhone(body.phone);
  } catch {
    return accountError("Enter a valid UK phone number.");
  }
  if (!phone) return accountError("A phone number is required.");
  const saved = await ctx.admin.auth.admin.updateUserById(ctx.user.id, {
    password: body.password,
    user_metadata: { ...ctx.user.user_metadata, setup_password_set: true },
  });
  if (saved.error) return accountError("Password could not be saved.", 503);
  const updated = await ctx.admin
    .from("profiles")
    .update({ phone })
    .eq("id", ctx.user.id);
  if (updated.error)
    return accountError("Phone could not be saved. Contact support.", 503);
  return NextResponse.json({ ok: true });
}
