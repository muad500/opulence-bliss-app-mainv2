import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { canUseProfessionalTools } from "@/lib/professionalAccess";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let next = safeNext(url.searchParams.get("next"));

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
    .select("role")
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
    return NextResponse.redirect(new URL(next, url.origin));
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

  const { data: legalRows } = await admin
    .from("legal_documents")
    .select("slug, version")
    .in("slug", ["terms", "privacy", "cancellation-refund"])
    .eq("published", true);
  const termsVersion =
    legalRows?.find((row) => row.slug === "terms")?.version ??
    LEGAL_VERSIONS.terms;
  const privacyVersion =
    legalRows?.find((row) => row.slug === "privacy")?.version ??
    LEGAL_VERSIONS.privacy;
  const cancellationVersion =
    legalRows?.find((row) => row.slug === "cancellation-refund")?.version ??
    LEGAL_VERSIONS["cancellation-refund"];
  const acceptedAt = new Date().toISOString();

  await admin.auth.admin.updateUserById(user.id, {
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
  });
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

  return NextResponse.redirect(new URL(next, url.origin));
}
