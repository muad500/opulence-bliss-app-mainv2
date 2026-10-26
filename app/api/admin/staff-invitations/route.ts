import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import {
  accountMailReady,
  sendPrivateAccountMail,
} from "@/lib/privateAccountMail";
import { deploymentOrigins } from "@/lib/adminHosts";
import { securityMailRecipientAllowed } from "@/lib/accountSecurityAlerts";
import {
  pendingStaffInvitation,
  staffInvitationEmail,
  staffInvitationLink,
} from "@/lib/staffInvitation";

export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const body = await request.json().catch(() => null);
  const email = staffInvitationEmail(body?.email);
  if (!email || body?.confirmAdminAccess !== true)
    return NextResponse.json(
      { error: "Confirm the email and admin access." },
      { status: 400 },
    );
  if (!accountMailReady())
    return NextResponse.json(
      { error: "Staff email is not configured." },
      { status: 503 },
    );
  if (!securityMailRecipientAllowed(email, process.env))
    return NextResponse.json(
      { error: "Use an approved staging test inbox." },
      { status: 403 },
    );
  let adminOrigin: string;
  try {
    adminOrigin = deploymentOrigins(process.env).admin;
  } catch {
    return NextResponse.json(
      { error: "The staff address is not configured." },
      { status: 503 },
    );
  }

  const existing = await ctx.admin
    .from("profiles")
    .select("id,role,account_deleted_at")
    .eq("email", email)
    .maybeSingle();
  if (existing.error)
    return NextResponse.json(
      { error: "The account could not be checked." },
      { status: 503 },
    );
  if (existing.data) {
    const account = await ctx.admin.auth.admin.getUserById(existing.data.id);
    if (
      account.error ||
      existing.data.role !== "admin" ||
      existing.data.account_deleted_at ||
      !pendingStaffInvitation(account.data.user)
    )
      return NextResponse.json(
        {
          error:
            "This address already has an account. Its access was not changed.",
        },
        { status: 409 },
      );
    const last = Date.parse(
      String(account.data.user.app_metadata.staff_invitation_at ?? ""),
    );
    if (Number.isFinite(last) && Date.now() - last < 60_000)
      return NextResponse.json(
        { error: "Wait a minute before sending another setup email." },
        { status: 429 },
      );
  }

  // Auth creates a passwordless, unconfirmed user and refuses an existing one.
  // Its server-owned metadata identifies only invitations created by this tool.
  let userId = existing.data?.id;
  if (!userId) {
    const created = await ctx.admin.auth.admin.createUser({
      email,
      email_confirm: false,
      app_metadata: { staff_invited_by: ctx.user.id },
    });
    if (created.error || !created.data.user)
      return NextResponse.json(
        {
          error:
            "This email could not be invited. No existing account was promoted.",
        },
        { status: 409 },
      );
    userId = created.data.user.id;
    const profile = await ctx.admin.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: "Opulence Bliss admin",
        role: "admin",
      },
      { onConflict: "id" },
    );
    if (profile.error)
      return NextResponse.json(
        {
          error:
            "The staff profile could not be saved. Contact support before retrying.",
        },
        { status: 503 },
      );
  }

  const generated = await ctx.admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo: `${adminOrigin}/staff/callback`,
    },
  });
  if (
    generated.error ||
    generated.data.user?.id !== userId ||
    !generated.data.properties?.hashed_token
  )
    return NextResponse.json(
      { error: "The setup link could not be created. No email was sent." },
      { status: 503 },
    );
  const now = new Date().toISOString();
  const saved = await ctx.admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...generated.data.user.app_metadata,
      staff_invited_by: ctx.user.id,
      staff_invitation_at: now,
    },
  });
  if (saved.error)
    return NextResponse.json(
      { error: "The invitation could not be recorded. No email was sent." },
      { status: 503 },
    );
  const link = staffInvitationLink(
    generated.data.properties.hashed_token,
    process.env,
  );
  const sent = await sendPrivateAccountMail(
    email,
    "Set up your Opulence Bliss admin account",
    `You have been invited to administer Opulence Bliss.\n\nOpen this private, single-use link to set up your authenticator and password:\n${link}\n\nStaff sign-in: ${adminOrigin}/staff/login\n\nDo not forward this email. If you did not expect this invitation, contact hello@opulencebliss.com.`,
    `staff-invitation-${userId}-${now}`,
  );
  if (!sent)
    return NextResponse.json(
      {
        error:
          "The email provider did not accept the setup email. Wait a minute, then retry.",
      },
      { status: 503 },
    );
  return NextResponse.json(
    { ok: true, email, setupOrigin: adminOrigin },
    { headers: { "Cache-Control": "no-store" } },
  );
}
