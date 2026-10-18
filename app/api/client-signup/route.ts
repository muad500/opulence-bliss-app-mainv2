// SETUP: mkdir -p "app/api/client-signup" && code "app/api/client-signup/route.ts"
//
// Create an immediately active customer account and profile.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { isValidUkPhone, normalizeUkPhone } from "@/lib/ukPhone";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const {
      fullName,
      salutation,
      firstName,
      lastName,
      email,
      password,
      phone,
      address,
      postcode,
      consentAccepted,
    } = await req.json();

    const normalizedEmail = String(email ?? "")
      .trim()
      .toLowerCase();
    const normalizedPhone = normalizeUkPhone(phone);

    if (consentAccepted !== true) {
      return NextResponse.json(
        {
          error:
            "Accept the Terms & Conditions, Privacy Policy and Cancellation & Refund Policy to sign up.",
        },
        { status: 400 },
      );
    }

    if (!fullName || !email || !password) {
      return NextResponse.json(
        { error: "Please fill in your name, email and a password." },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (!isValidUkPhone(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 },
      );
    }
    if (String(password).length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 },
      );
    }

    const { data: legalRows } = await admin
      .from("legal_documents")
      .select("slug, version")
      .in("slug", ["terms", "privacy", "cancellation-refund"])
      .eq("published", true);
    const legalVersions = Object.fromEntries(
      ["terms", "privacy", "cancellation-refund"].map((slug) => [
        slug,
        legalRows?.find((row) => row.slug === slug)?.version ??
          LEGAL_VERSIONS[slug],
      ]),
    );

    const userMetadata = {
      salutation: salutation || null,
      first_name: firstName || null,
      last_name: lastName || null,
      address: address || null,
      legal_accepted: true,
      legal_version: legalVersions.terms,
      legal_versions: legalVersions,
      legal_accepted_at: new Date().toISOString(),
    };
    const credentials = { email: normalizedEmail, password: String(password) };
    const { data: created, error: creationError } =
      await admin.auth.admin.createUser({
        ...credentials,
        email_confirm: true,
        user_metadata: userMetadata,
      });
    const createdUser = created.user;

    if (creationError || !createdUser) {
      const msg = creationError?.message ?? "Could not create your account.";
      const exists = /already|exists|registered/i.test(msg);
      return NextResponse.json(
        {
          error: exists
            ? "There's already an account with that email — sign in instead."
            : msg,
          exists,
        },
        { status: 400 },
      );
    }

    // Profile, filled in properly from the start.
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: createdUser.id,
        email: normalizedEmail,
        role: "customer",
        full_name: String(fullName).trim(),
        phone: normalizedPhone,
        address: address ? String(address).trim() : null,
        postcode: postcode ? String(postcode).trim().toUpperCase() : null,
      },
      { onConflict: "id" },
    );

    if (profileError) {
      await admin.auth.admin.deleteUser(createdUser.id);
      throw profileError;
    }

    return NextResponse.json({ ok: true, confirmationEmailSent: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sign-up failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
