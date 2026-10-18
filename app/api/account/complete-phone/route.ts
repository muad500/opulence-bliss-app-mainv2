import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  accountError,
  isAccountError,
  normaliseGbPhone,
  readAccountBody,
} from "@/lib/accountApi";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  try {
    const phone = normaliseGbPhone(body.phone);
    if (!phone) return accountError("Enter your UK phone number.");
    // Only an initial missing number may be set here. Existing numbers use OTP-protected account settings.
    const result = await ctx.admin
      .from("profiles")
      .update({ phone })
      .eq("id", ctx.user.id)
      .or("phone.is.null,phone.eq.")
      .select("id");
    if (result.error) return accountError("Phone could not be saved.", 503);
    if (!result.data?.length)
      return accountError(
        "Change your existing phone in account settings.",
        409,
      );
    return NextResponse.json({ ok: true });
  } catch {
    return accountError("Enter a valid UK phone number.");
  }
}
