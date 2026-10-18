import { NextRequest, NextResponse } from "next/server";
import { adminApi } from "@/lib/adminApi";
import { normaliseGbPhone } from "@/lib/accountApi";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { sendPrivateAccountMail } from "@/lib/privateAccountMail";

export async function GET(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const rows = await ctx.admin
    .from("professional_setup_invitations")
    .select("provider_id,sent_at,providers(display_name)")
    .is("setup_completed_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (rows.error)
    return NextResponse.json(
      { error: "Pending invitations could not be loaded." },
      { status: 503 },
    );
  return NextResponse.json(
    { invitations: rows.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const ctx = await adminApi(request);
  if (ctx instanceof NextResponse) return ctx;
  const body = await request.json().catch(() => null);
  if (body?.action === "resend") {
    if (!/^[0-9a-f-]{36}$/.test(body.providerId ?? ""))
      return NextResponse.json(
        { error: "Invalid professional." },
        { status: 400 },
      );
    const invitation = await ctx.admin
      .from("professional_setup_invitations")
      .select("user_id,sent_at,setup_completed_at")
      .eq("provider_id", body.providerId)
      .maybeSingle();
    if (!invitation.data || invitation.data.setup_completed_at)
      return NextResponse.json(
        { error: "There is no pending setup invitation." },
        { status: 409 },
      );
    if (
      invitation.data.sent_at &&
      Date.parse(invitation.data.sent_at) > Date.now() - 60000
    )
      return NextResponse.json(
        { error: "Wait a minute before sending another invitation." },
        { status: 429 },
      );
    const person = await ctx.admin.auth.admin.getUserById(
      invitation.data.user_id,
    );
    if (!person.data.user?.email)
      return NextResponse.json(
        { error: "Account unavailable." },
        { status: 404 },
      );
    const generated = await ctx.admin.auth.admin.generateLink({
      type: "magiclink",
      email: person.data.user.email,
    });
    if (generated.error || !generated.data.properties?.hashed_token)
      return NextResponse.json(
        { error: "Setup link could not be renewed." },
        { status: 503 },
      );
    const link = new URL("/auth/confirm", request.nextUrl.origin);
    link.searchParams.set("token_hash", generated.data.properties.hashed_token);
    link.searchParams.set("type", "magiclink");
    link.searchParams.set(
      "next",
      person.data.user.user_metadata?.setup_password_set
        ? "/provider/join"
        : "/professional-setup",
    );
    const sent = await sendPrivateAccountMail(
      person.data.user.email,
      "Complete your Opulence Bliss professional setup",
      `Complete your pending application using this private link: ${link}\nYour service remains pending until all checks are reviewed and approved.`,
      `professional-resend-${body.providerId}-${Date.now()}`,
    );
    if (sent)
      await ctx.admin
        .from("professional_setup_invitations")
        .update({ sent_at: new Date().toISOString() })
        .eq("provider_id", body.providerId);
    return NextResponse.json({
      ok: true,
      sent,
      message: sent
        ? "Setup invitation sent."
        : "Email is not available yet. The professional remains pending; try again after sender setup.",
    });
  }
  const email = String(body?.email ?? "")
      .trim()
      .toLowerCase(),
    name = String(body?.name ?? "").trim();
  let phone: string | null | undefined;
  try {
    phone = normaliseGbPhone(body?.phone);
  } catch {
    /* Validated below. */
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !name ||
    name.length > 160 ||
    !phone
  )
    return NextResponse.json(
      {
        error: "Enter the professional's full name, email and UK phone number.",
      },
      { status: 400 },
    );
  const services = body?.services;
  if (
    !Array.isArray(services) ||
    !services.length ||
    services.some(
      (s) => s !== "cleaning" && (s !== "handyman" || !handymanEnabled()),
    )
  )
    return NextResponse.json(
      { error: "Select an available service." },
      { status: 400 },
    );
  const existing = await ctx.admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing.error || existing.data)
    return NextResponse.json(
      {
        error:
          "This email already has an account. Ask the person to add a service from their own profile.",
      },
      { status: 409 },
    );
  const created = await ctx.admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: name, admin_invited_professional: true } },
  });
  if (
    created.error ||
    !created.data.user ||
    !created.data.properties?.hashed_token
  )
    return NextResponse.json(
      {
        error:
          "An invitation could not be created. The email may already be registered.",
      },
      { status: 409 },
    );
  const userId = created.data.user.id;
  const profile = await ctx.admin
    .from("profiles")
    .upsert(
      { id: userId, full_name: name, email, phone, role: "provider" },
      { onConflict: "id" },
    );
  if (profile.error)
    return NextResponse.json(
      {
        error:
          "Invitation is pending, but the account record needs support before retrying.",
      },
      { status: 503 },
    );
  const provider = await ctx.admin
    .from("providers")
    .insert({
      profile_id: userId,
      display_name: name,
      services: [...new Set(services)],
      vetting_status: "pending",
      show_on_our_pros: false,
    })
    .select("id")
    .single();
  if (provider.error)
    return NextResponse.json(
      {
        error:
          "Account created, but professional setup could not be prepared. Contact support.",
      },
      { status: 503 },
    );
  const invitation = await ctx.admin
    .from("professional_setup_invitations")
    .insert({
      provider_id: provider.data.id,
      user_id: userId,
      created_by: ctx.user.id,
    });
  if (invitation.error)
    return NextResponse.json(
      {
        error: "Professional created as pending. Setup delivery needs support.",
      },
      { status: 503 },
    );
  const link = new URL("/auth/confirm", request.nextUrl.origin);
  link.searchParams.set("token_hash", created.data.properties.hashed_token);
  link.searchParams.set("type", "invite");
  link.searchParams.set("next", "/professional-setup");
  const sent = await sendPrivateAccountMail(
    email,
    "Set up your Opulence Bliss professional account",
    `You have been invited to complete your professional application. Create your password and complete your details here: ${link}\nYou cannot receive jobs until your application, insurance, proof of address and other required checks are verified. If you did not expect this invitation, contact hello@opulencebliss.com.`,
    `professional-invitation-${provider.data.id}`,
  );
  if (sent)
    await ctx.admin
      .from("professional_setup_invitations")
      .update({ sent_at: new Date().toISOString() })
      .eq("provider_id", provider.data.id);
  return NextResponse.json(
    {
      ok: true,
      sent,
      providerId: provider.data.id,
      message: sent
        ? "Professional created as pending. Setup invitation sent."
        : "Professional created as pending. Setup email is blocked until the sender is configured; no service approval or job access has been granted.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
