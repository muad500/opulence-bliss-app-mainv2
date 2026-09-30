import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountContext, accountError, isAccountError, readAccountBody } from "@/lib/accountApi";
import { verifyCurrentPassword } from "@/lib/accountPassword";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const { currentPassword, newEmail } = body;
  if (typeof newEmail !== "string" || newEmail.length > 180 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(newEmail.trim())) {
    return accountError("Enter a valid new email address.");
  }
  if (newEmail.trim().toLowerCase() === ctx.user.email?.toLowerCase()) return accountError("This is already your email address.");
  if (!await verifyCurrentPassword(ctx.user.id, ctx.user.email, currentPassword)) return accountError("Your current password is incorrect.", 403);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() });
  if (error) return accountError("Email could not be changed. Please try again.", 503);
  return NextResponse.json({ ok: true, message: "Check your email for a confirmation link if required by your account settings." });
}
