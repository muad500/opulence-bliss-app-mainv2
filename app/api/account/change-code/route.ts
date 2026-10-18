import { randomBytes, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  accountContext,
  accountError,
  isAccountError,
  readAccountBody,
} from "@/lib/accountApi";
import {
  accountChangeHash,
  accountSessionId,
} from "@/lib/accountChangeVerification";
import {
  accountMailReady,
  sendPrivateAccountMail,
} from "@/lib/privateAccountMail";
import { bookingSmsConfig, submitBookingSms } from "@/lib/bookingSms";

export async function POST(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  const session = await accountSessionId();
  if (!session) return accountError("Please sign in again.", 401);
  if (body.action === "verify") {
    if (
      typeof body.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(body.id) ||
      typeof body.code !== "string" ||
      !/^\d{6}$/.test(body.code)
    )
      return accountError("Enter the six-digit code.");
    const proof = randomBytes(32).toString("hex");
    const result = await ctx.admin.rpc("verify_account_change", {
      p_id: body.id,
      p_user: ctx.user.id,
      p_session: session,
      p_code: accountChangeHash(ctx.user.id + ":" + body.code),
      p_grant: accountChangeHash(proof),
    });
    if (result.error || result.data !== true)
      return accountError("That code is incorrect, expired or already used.");
    return NextResponse.json(
      { proof },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (
    body.action !== "send" ||
    typeof body.requestHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.requestHash)
  )
    return accountError("Invalid verification request.");
  const sms = bookingSmsConfig(process.env);
  if (!sms && !accountMailReady())
    return accountError(
      "Verification email is not available yet. Your details have not changed. Contact hello@opulencebliss.com.",
      503,
    );
  const { data: profile } = await ctx.admin
    .from("profiles")
    .select("phone")
    .eq("id", ctx.user.id)
    .single();
  const useSms = !!sms && /^\+44\d{10}$/.test(profile?.phone ?? "");
  if (!useSms && (!ctx.user.email || !accountMailReady()))
    return accountError(
      "A verified email sender is needed before changing account details.",
      503,
    );
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await ctx.admin.rpc("start_account_change", {
    p_user: ctx.user.id,
    p_session: session,
    p_hash: body.requestHash,
    p_code: accountChangeHash(ctx.user.id + ":" + code),
    p_channel: useSms ? "sms" : "email",
    p_sms_budget: useSms ? sms!.monthlyBudgetPence : 0,
    p_sms_cost: useSms ? sms!.costCapPence : 0,
  });
  if (challenge.error)
    return accountError(
      "Please wait before requesting another code, or contact support.",
      429,
    );
  let sent = false;
  if (useSms) {
    try {
      await submitBookingSms(
        sms!,
        profile!.phone,
        `Opulence Bliss: ${code} is your account change code. Expires in 10 minutes. Never share this code.`,
      );
      sent = true;
    } catch {
      /* Uncertain sends are never automatically retried. */
    }
  } else
    sent = await sendPrivateAccountMail(
      ctx.user.email!,
      "Confirm your account change",
      `Your Opulence Bliss account change code is ${code}. It expires in 10 minutes. If you did not request this, do not share the code and contact hello@opulencebliss.com.`,
      `account-change-${challenge.data}`,
    );
  if (!sent)
    return accountError(
      "The code could not be sent. Your details have not changed.",
      503,
    );
  const marked = await ctx.admin
    .from("account_change_challenges")
    .update({ sent: true })
    .eq("id", challenge.data);
  if (marked.error)
    return accountError(
      "Verification could not be started. Please try later.",
      503,
    );
  return NextResponse.json(
    {
      id: challenge.data,
      channel: useSms ? "SMS" : "email",
      destination: useSms
        ? `phone ending ${profile!.phone.slice(-4)}`
        : "your current email address",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
