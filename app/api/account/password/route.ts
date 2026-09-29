import { NextRequest, NextResponse } from "next/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";
import { verifyCurrentPassword } from "@/lib/accountPassword";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const { currentPassword, newPassword } = body;
  if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128) {
    return accountError("Use a new password of at least 12 characters.");
  }
  if (!await verifyCurrentPassword(ctx.user.id, ctx.user.email, currentPassword)) {
    return accountError("Your current password is incorrect.", 403);
  }
  if (newPassword === currentPassword) return accountError("Choose a different password.");
  const { error } = await ctx.admin.auth.admin.updateUserById(ctx.user.id, { password: newPassword });
  if (error) return accountError("Password could not be changed. Please try again.", 503);
  return NextResponse.json({ ok: true });
}
