import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  OAUTH_ACCEPTANCE_COOKIE,
  readOAuthAcceptance,
  prepareAccountAcceptance,
  saveAccountAcceptance,
} from "@/lib/accountAcceptanceServer";
import { canUseProfessionalTools } from "@/lib/professionalAccess";
import { safeAuthNext } from "@/lib/authReturn";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let next = safeAuthNext(url.searchParams.get("next")) ?? "/account";

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=google-callback", url.origin),
    );
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(
      new URL("/login?error=google-callback", url.origin),
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/login?error=google-account", url.origin),
    );
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: existing } = await admin
    .from("profiles")
    .select("role,phone")
    .eq("id", user.id)
    .maybeSingle();

  if (existing?.role === "admin") {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/login?error=wrong-account", url.origin),
    );
  }

  if (next === "/account") {
    const [details, professional] = await Promise.all([
      admin
        .from("account_profile_details")
        .select("last_account_mode")
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("providers")
        .select("id,vetting_status,is_suspended,service_approvals")
        .eq("profile_id", user.id)
        .maybeSingle(),
    ]);
    if (
      canUseProfessionalTools(professional.data) &&
      details.data?.last_account_mode === "professional"
    )
      next = "/worker";
  }

  if (existing && user.user_metadata?.legal_accepted === true) {
    return NextResponse.redirect(
      new URL(
        existing?.phone
          ? next
          : `/complete-profile?next=${encodeURIComponent(next)}`,
        url.origin,
      ),
    );
  }

  if (!existing) {
    const fullName = String(
      user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        user.email.split("@")[0],
    ).trim();
    const { error: profileError } = await admin.from("profiles").insert({
      id: user.id,
      email: user.email.toLowerCase(),
      role: "customer",
      full_name: fullName,
    });
    if (profileError) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=profile", url.origin));
    }
  }

  const pending = readOAuthAcceptance(
    request.cookies.get(OAUTH_ACCEPTANCE_COOKIE)?.value,
  );
  if (!pending) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/auth/sign-up?error=consent", url.origin),
    );
  }
  let prepared;
  try {
    prepared = await prepareAccountAcceptance(
      admin,
      pending.documents.map((d) => d.slug),
      request.headers,
      pending.checkboxes,
      pending.action,
    );
  } catch {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=consent", url.origin));
  }
  if (
    JSON.stringify(
      prepared.documents.map((d) => ({
        slug: d.slug,
        version: d.version,
        contentHash: d.contentHash,
        displayContentHash: d.displayContentHash,
      })),
    ) !== JSON.stringify(pending.documents)
  ) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/auth/sign-up?error=policies-changed", url.origin),
    );
  }
  // Record the request where the user accepted, before leaving for Google.
  prepared.request = pending.request;
  const termsVersion = prepared.documents.find(
    (d) => d.slug === "terms",
  )!.version;
  const privacyVersion = prepared.documents.find(
    (d) => d.slug === "privacy",
  )!.version;
  const cancellationVersion = prepared.documents.find(
    (d) => d.slug === "cancellation-refund",
  )!.version;
  const acceptedAt = pending.acceptedAt;
  prepared.acceptedAt = acceptedAt;

  try {
    await saveAccountAcceptance(admin, user.id, prepared, acceptedAt);
  } catch {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=consent", url.origin));
  }
  const { error: consentError } = await admin.rpc(
    "record_oauth_signup_consent",
    {
      p_user_id: user.id,
      p_legal_version: termsVersion,
      p_accepted_at: acceptedAt,
    },
  );
  if (consentError) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=consent", url.origin));
  }

  const { error: metadataError } = await admin.auth.admin.updateUserById(
    user.id,
    {
      user_metadata: {
        ...user.user_metadata,
        legal_accepted: true,
        legal_version: termsVersion,
        legal_versions: {
          terms: termsVersion,
          privacy: privacyVersion,
          "cancellation-refund": cancellationVersion,
        },
        legal_accepted_at: acceptedAt,
      },
    },
  );
  if (metadataError) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=consent", url.origin));
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  response.cookies.set(OAUTH_ACCEPTANCE_COOKIE, "", {
    path: "/auth/callback",
    maxAge: 0,
  });
  return response;
}
