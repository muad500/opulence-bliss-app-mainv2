import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cleanerStage2Enabled } from "@/lib/cleanerApplication";
import { isSameOriginMutation } from "@/lib/accountApi";
import {
  hashOnboardingAccess,
  validOnboardingAccess,
} from "@/lib/cleanerOnboardingAccess";
import { onboardingPreviewOrigin } from "@/lib/cleanerOnboardingMail";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: NextRequest) {
  if (!cleanerStage2Enabled())
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Open this request from the assessment." },
      { status: 403, headers },
    );
  const session = request.cookies.get(
    "__Host-opulence-cleaner-assessment",
  )?.value;
  if (!validOnboardingAccess(session))
    return NextResponse.json(
      { error: "Use your passed assessment session." },
      { status: 401, headers },
    );
  try {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const checked = await client.rpc("cleaner_passed_setup_context", {
      p_session_hash: hashOnboardingAccess(session),
    });
    if (checked.error || !checked.data)
      return NextResponse.json(
        { error: "A passed assessment and resolved review are required." },
        { status: 403, headers },
      );
    const applicant = checked.data;
    // Existing Auth identities are kept; no account is created before passing.
    const existing = await client
      .from("profiles")
      .select("id,role")
      .eq("email", applicant.email)
      .maybeSingle();
    if (existing.error || existing.data?.role === "admin") throw Error();
    const generated = await client.auth.admin.generateLink(
      existing.data
        ? { type: "magiclink", email: applicant.email }
        : {
            type: "invite",
            email: applicant.email,
            options: { data: { full_name: applicant.fullName } },
          },
    );
    if (
      generated.error ||
      !generated.data.user ||
      !generated.data.properties?.hashed_token
    )
      throw Error();
    const linked = await client.rpc("link_cleaner_passed_account", {
      p_session_hash: hashOnboardingAccess(session),
      p_user: generated.data.user.id,
    });
    if (linked.error) throw Error();
    const url = new URL("/auth/confirm", onboardingPreviewOrigin());
    url.searchParams.set("token_hash", generated.data.properties.hashed_token);
    url.searchParams.set("type", existing.data ? "magiclink" : "invite");
    url.searchParams.set("next", "/cleaner-setup");
    return NextResponse.json({ url: url.toString() }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Account setup could not be prepared. Your assessment result is unchanged; ask the host to help.",
      },
      { status: 503, headers },
    );
  }
}
