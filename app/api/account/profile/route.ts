import { NextRequest, NextResponse } from "next/server";
import {
  accountContext, accountError, isAccountError, isRecord,
  normaliseGbPhone, optionalBoolean, optionalText, readAccountBody, safeProfilePhoto,
  type AccountContext,
} from "@/lib/accountApi";

async function loadProfile({ user, admin }: AccountContext) {
  const [profileResult, detailResult, addressesResult, legalResult, consentResult, favouritesResult] = await Promise.all([
    admin.from("profiles").select("id,email,role,full_name,phone,address,postcode,client_rating_avg,client_rating_count").eq("id", user.id).single(),
    admin.from("account_profile_details").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("customer_addresses").select("*").eq("user_id", user.id).order("is_default", { ascending: false }).order("created_at"),
    admin.from("account_legal_acceptances").select("document_slug,version,accepted_at").eq("user_id", user.id).order("accepted_at", { ascending: false }),
    admin.from("signup_consents").select("legal_version,accepted_at").eq("user_id", user.id).maybeSingle(),
    admin.from("customer_favourite_providers").select("provider_id,providers(display_name,photo_url,rating_avg)").eq("user_id", user.id),
  ]);
  if (profileResult.error || detailResult.error || addressesResult.error || legalResult.error || consentResult.error || favouritesResult.error) {
    throw new Error("Account details could not be loaded. The profile update may still be pending.");
  }
  const p = profileResult.data;
  const d = detailResult.data;
  const metadata = user.user_metadata ?? {};
  const legacyName = String(p.full_name ?? "").trim().split(/\s+/);
  const acceptances = (legalResult.data ?? []).map((row) => ({
    documentSlug: row.document_slug, version: row.version, acceptedAt: row.accepted_at,
  }));
  if (consentResult.data && !acceptances.some((row) => row.documentSlug === "terms")) {
    acceptances.push({ documentSlug: "terms", version: consentResult.data.legal_version, acceptedAt: consentResult.data.accepted_at });
  }
  return {
    profile: {
      title: d?.title ?? metadata.salutation ?? null,
      firstName: d?.first_name ?? metadata.first_name ?? legacyName[0] ?? "",
      lastName: d?.last_name ?? metadata.last_name ?? legacyName.slice(1).join(" "),
      fullName: p.full_name ?? "",
      email: user.email ?? p.email ?? "",
      phone: p.phone ?? "",
      photoUrl: d?.photo_storage_path ? (await admin.storage.from("profile-photos").createSignedUrl(d.photo_storage_path, 3600)).data?.signedUrl ?? "" : d?.photo_url ?? "",
      customerRatingAvg: p.client_rating_avg == null ? null : Number(p.client_rating_avg),
      customerRatingCount: p.client_rating_count ?? 0,
    },
    addresses: (addressesResult.data ?? []).map((row) => ({
      id: row.id, label: row.label, isDefault: row.is_default,
      line1: row.line1, line2: row.line2 ?? "", city: row.city, postcode: row.postcode,
      accessInstructions: row.access_instructions ?? "", propertyType: row.property_type ?? "",
      bedrooms: row.bedrooms, bathrooms: row.bathrooms, pets: row.pets ?? "",
      productsProvidedBy: row.products_provided_by,
    })),
    preferences: {
      contactChannels: [d?.contact_email !== false && "email", d?.contact_sms === true && "sms", d?.contact_whatsapp === true && "whatsapp"].filter(Boolean),
      notifications: { bookings: d?.notify_bookings !== false, messages: d?.notify_messages !== false },
      marketingEmails: d?.marketing_emails === true,
    },
    favourites: (favouritesResult.data ?? []).map((row) => {
      const provider = Array.isArray(row.providers) ? row.providers[0] : row.providers;
      return {
        providerId: row.provider_id,
        displayName: provider?.display_name ?? "Professional",
        photoUrl: provider?.photo_url ?? null,
        ratingAvg: provider?.rating_avg == null ? null : Number(provider.rating_avg),
      };
    }),
    legalAcceptances: acceptances,
  };
}

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request);
  if (isAccountError(ctx)) return ctx;
  try {
    return NextResponse.json(await loadProfile(ctx));
  } catch (error) {
    return accountError(error instanceof Error ? error.message : "Account details could not be loaded.", 503);
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = await accountContext(request, { mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  if (body.profile !== undefined && !isRecord(body.profile)) return accountError("Invalid personal details.");
  if (body.preferences !== undefined && !isRecord(body.preferences)) return accountError("Invalid preferences.");
  const profile = (body.profile ?? {}) as Record<string, unknown>;
  const preferences = (body.preferences ?? {}) as Record<string, unknown>;
  try {
    const allowedProfile = new Set(["title", "firstName", "lastName", "phone", "photoUrl"]);
    const allowedPreferences = new Set(["contactChannels", "notifications", "marketingEmails"]);
    if (Object.keys(profile).some((key) => !allowedProfile.has(key)) || Object.keys(preferences).some((key) => !allowedPreferences.has(key))) {
      return accountError("Unsupported account field.");
    }
    const details: Record<string, unknown> = { user_id: ctx.user.id, updated_at: new Date().toISOString() };
    if ("title" in profile) {
      const title = optionalText(profile.title, 20);
      if (title && !["mr", "mrs", "miss", "ms", "mx", "other"].includes(title)) return accountError("Choose a valid title.");
      details.title = title;
    }
    if ("firstName" in profile) details.first_name = optionalText(profile.firstName, 80);
    if ("lastName" in profile) details.last_name = optionalText(profile.lastName, 80);
    if ("photoUrl" in profile) details.photo_url = safeProfilePhoto(profile.photoUrl);
    if ("contactChannels" in preferences) {
      const channels = preferences.contactChannels;
      if (!Array.isArray(channels) || channels.some((channel) => !["email", "sms", "whatsapp"].includes(channel))) return accountError("Choose valid contact options.");
      details.contact_email = channels.includes("email");
      details.contact_sms = channels.includes("sms");
      details.contact_whatsapp = channels.includes("whatsapp");
    }
    if ("notifications" in preferences) {
      if (!isRecord(preferences.notifications)) return accountError("Choose valid notifications.");
      if ("bookings" in preferences.notifications) details.notify_bookings = optionalBoolean(preferences.notifications.bookings);
      if ("messages" in preferences.notifications) details.notify_messages = optionalBoolean(preferences.notifications.messages);
    }
    if ("marketingEmails" in preferences) details.marketing_emails = optionalBoolean(preferences.marketingEmails);
    const profileChanges: Record<string, unknown> = {};
    if ("phone" in profile) profileChanges.phone = normaliseGbPhone(profile.phone);
    if ("firstName" in profile || "lastName" in profile) {
      const current = await ctx.admin.from("profiles").select("full_name").eq("id", ctx.user.id).single();
      if (current.error) return accountError("Personal details could not be updated.", 503);
      const currentParts = String(current.data.full_name ?? "").trim().split(/\s+/);
      const first = "firstName" in profile ? optionalText(profile.firstName, 80) : ctx.user.user_metadata?.first_name ?? currentParts[0];
      const last = "lastName" in profile ? optionalText(profile.lastName, 80) : ctx.user.user_metadata?.last_name ?? currentParts.slice(1).join(" ");
      const fullName = `${first ?? ""} ${last ?? ""}`.trim();
      if (!fullName) return accountError("Enter your name.");
      profileChanges.full_name = fullName;
    }
    if (Object.keys(details).length > 2) {
      const { error } = await ctx.admin.from("account_profile_details").upsert(details, { onConflict: "user_id" });
      if (error) return accountError("Preferences could not be saved. Check that the profile migration is installed.", 503);
    }
    if (Object.keys(profileChanges).length) {
      const { error } = await ctx.admin.from("profiles").update(profileChanges).eq("id", ctx.user.id);
      if (error) return accountError("Personal details could not be saved.", 503);
    }
    return NextResponse.json(await loadProfile(ctx));
  } catch (error) {
    return accountError(error instanceof Error ? error.message : "Invalid account details.");
  }
}
