import { NextRequest, NextResponse } from "next/server";
import {
  accountContext, accountError, isAccountError, isRecord, normaliseGbPhone,
  optionalBoolean, optionalInteger, optionalText, readAccountBody, safeProfilePhoto,
  textList, type AccountContext,
} from "@/lib/accountApi";
import {dbsRecheckDate} from '@/lib/verificationRenewal';

const HANDYMAN_TASKS = [
  "Mounting and hanging", "Furniture assembly", "Minor repairs",
  "Curtains and blinds", "Furniture moving", "Minor decorating",
];

async function loadWorkerProfile(ctx: AccountContext) {
  const providerId = ctx.providerId!;
  const [profileResult, providerResult, onboardingResult, settingsResult, verificationResult, dbsResult, ratesResult, timeOffResult, legalResult] = await Promise.all([
    ctx.admin.from("profiles").select("full_name,email,phone,postcode").eq("id", ctx.user.id).single(),
    ctx.admin.from("providers").select("id,display_name,bio,photo_url,years_experience,services,rating_avg,rating_count,stripe_account_id,payout_schedule,vetting_status,is_suspended").eq("id", providerId).single(),
    ctx.admin.from("provider_onboarding_details").select("date_of_birth,utr_number,resident_status,right_to_work,weekly_availability,preferred_weekly_hours").eq("provider_id", providerId).maybeSingle(),
    ctx.admin.from("provider_profile_settings").select("*").eq("provider_id", providerId).maybeSingle(),
    ctx.admin.from("provider_verification_items").select("document_type,label,status,reference,issued_at,expires_at,checked_at,gov_uk_checked_on,next_check_at,uploaded_at,document_original_name,document_storage_path,review_note").eq("provider_id", providerId).order("created_at", { ascending: false }),
    ctx.admin.from("provider_dbs_checks").select("status,certificate_number,issue_date,review_note,uploaded_at,reviewed_at,certificate_storage_path").eq("provider_id", providerId).maybeSingle(),
    ctx.admin.from("provider_task_rates").select("task_name,hourly_rate_pence").eq("provider_id", providerId),
    ctx.admin.from("provider_time_off").select("id,starts_at,ends_at,note").eq("provider_id", providerId).gte("ends_at", new Date().toISOString()).order("starts_at"),
    ctx.admin.from("account_legal_acceptances").select("document_slug,version,accepted_at").eq("user_id", ctx.user.id),
  ]);
  if ([profileResult, providerResult, onboardingResult, settingsResult, verificationResult, dbsResult, ratesResult, timeOffResult, legalResult].some((result) => result.error)) {
    throw new Error("Professional details could not be loaded. The profile update may still be pending.");
  }
  const profile = profileResult.data;
  const provider = providerResult.data;
  if (!profile || !provider) throw new Error("Professional account not found.");
  const application = onboardingResult.data;
  const {data:verificationBlock,error:verificationBlockError}=await ctx.admin.rpc('professional_verification_block',{p_provider_id:providerId});
  if(verificationBlockError)throw new Error('Verification status could not be loaded.');
  const settings = settingsResult.data;
  const nowDate = new Date().toISOString().slice(0, 10);
  const verification = (verificationResult.data ?? []).filter((row) => row.document_type !== "dbs").map((row) => ({
    type: row.document_type,
    label: row.label,
    status: row.status === "verified" && ((row.expires_at && row.expires_at < nowDate) || (row.next_check_at && row.next_check_at < nowDate)) ? "expired" : row.status,
    reference: row.reference,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    lastCheckedAt: row.document_type==='right_to_work'?row.gov_uk_checked_on:row.checked_at,
    nextCheckAt: row.next_check_at,
    uploadedAt: row.uploaded_at,
    originalName: row.document_original_name,
    hasDocument: !!row.document_storage_path,
    reviewNote: row.review_note,
  }));
  if (dbsResult.data) {
    const dbs = dbsResult.data;
    verification.push({
      type: "dbs", label: "DBS check", status: dbs.status === "failed" ? "rejected" : dbs.status==='verified'&&(dbsRecheckDate(dbs.issue_date)??'')<nowDate?'expired':dbs.status,
      reference: dbs.certificate_number, issuedAt: dbs.issue_date, expiresAt: null,
      lastCheckedAt: dbs.reviewed_at, nextCheckAt: dbsRecheckDate(dbs.issue_date), uploadedAt: dbs.uploaded_at,
      originalName: null, hasDocument: !!dbs.certificate_storage_path,
      reviewNote: dbs.review_note,
    });
  }
  const legalAcceptances = (legalResult.data ?? []).map((row) => ({ documentSlug: row.document_slug, version: row.version, acceptedAt: row.accepted_at }));
  if (ctx.user.user_metadata?.professional_agreement_accepted === true && !legalAcceptances.some((row) => row.documentSlug === "professional-partner-agreement")) {
    legalAcceptances.push({
      documentSlug: "professional-partner-agreement",
      version: String(ctx.user.user_metadata.professional_agreement_version ?? "unknown"),
      acceptedAt: String(ctx.user.user_metadata.professional_agreement_accepted_at ?? ""),
    });
  }
  return {
    personal: {
      legalName: profile.full_name ?? "", dateOfBirth: application?.date_of_birth ?? null,
      email: ctx.user.email ?? profile.email ?? "", phone: profile.phone ?? "",
      homePostcode: settings?.home_postcode ?? profile.postcode ?? "",
      emergencyContactName: settings?.emergency_contact_name ?? "",
      emergencyContactPhone: settings?.emergency_contact_phone ?? "",
      residentStatus: application?.resident_status ?? null,
    },
    publicProfile: {
      displayName: provider.display_name ?? "", photoUrl: settings?.photo_storage_path ? (await ctx.admin.storage.from("profile-photos").createSignedUrl(settings.photo_storage_path, 3600)).data?.signedUrl ?? "" : provider.photo_url ?? "",
      bio: provider.bio ?? "", languages: settings?.languages ?? [],
      yearsExperience: provider.years_experience ?? null, services: provider.services ?? [],
      equipmentProvided: settings?.brings_equipment ?? false,
      ratingAvg: provider.rating_avg == null ? null : Number(provider.rating_avg),
      ratingCount: provider.rating_count ?? 0,
      handymanRates: Object.fromEntries((ratesResult.data ?? []).map((row) => [row.task_name, row.hourly_rate_pence / 100])),
    },
    work: {
      coveragePostcodes: settings?.coverage_postcodes ?? [],
      maxTravelMiles: settings?.max_travel_miles ?? null,
      maxDailyHours: settings?.max_daily_hours ?? null,
      acceptsSameDay: settings?.accepts_same_day ?? true,
      weeklyAvailability: application?.weekly_availability ?? null,
      preferredWeeklyHours: application?.preferred_weekly_hours ?? null,
      timeOff: (timeOffResult.data ?? []).map((row) => ({
        id: row.id, startDate: row.starts_at.slice(0, 10),
        endDate: new Date(Date.parse(row.ends_at) - 86400000).toISOString().slice(0, 10),
        note: row.note ?? "",
      })),
    },
    verification,
    payout: {
      stripeAccountId: provider.stripe_account_id ?? null,
      status: provider.stripe_account_id ? "connected" : "not_connected",
      schedule: provider.payout_schedule ?? "weekly",
    },
    tax: { utrNumber: application?.utr_number ?? "", vatNumber: settings?.vat_number ?? "" },
    alerts: {
      jobOffers: { app: settings?.alert_app !== false, sms: settings?.alert_sms === true, email: settings?.alert_email !== false },
      notifications: { messages: settings?.notify_messages !== false },
    },
    legalAcceptances,
    accountStatus: { vetting: provider.vetting_status, suspended: provider.is_suspended, verificationBlock, canUseJobs: ctx.professionalApproved },
  };
}

export async function GET(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true });
  if (isAccountError(ctx)) return ctx;
  try { return NextResponse.json(await loadWorkerProfile(ctx)); }
  catch (error) { return accountError(error instanceof Error ? error.message : "Professional details could not be loaded.", 503); }
}

export async function PATCH(request: NextRequest) {
  const ctx = await accountContext(request, { provider: true, mutation: true });
  if (isAccountError(ctx)) return ctx;
  const body = await readAccountBody(request);
  if (body instanceof NextResponse) return body;
  for (const key of Object.keys(body)) {
    if (!["personal", "publicProfile", "work", "tax", "alerts"].includes(key) || !isRecord(body[key])) return accountError("Unsupported professional field.");
  }
  const personal = (body.personal ?? {}) as Record<string, unknown>;
  const publicProfile = (body.publicProfile ?? {}) as Record<string, unknown>;
  const work = (body.work ?? {}) as Record<string, unknown>;
  const tax = (body.tax ?? {}) as Record<string, unknown>;
  const alerts = (body.alerts ?? {}) as Record<string, unknown>;
  if (!ctx.professionalApproved && Object.keys(work).length) return accountError("Working tools unlock after your application is approved.", 403);
  try {
    const allowed: [Record<string, unknown>, string[]][] = [
      [personal, ["legalName", "phone", "homePostcode", "emergencyContactName", "emergencyContactPhone"]],
      [publicProfile, ["displayName", "photoUrl", "bio", "languages", "yearsExperience", "equipmentProvided", "handymanRates"]],
      [work, ["coveragePostcodes", "maxTravelMiles", "maxDailyHours", "acceptsSameDay"]],
      [tax, ["utrNumber", "vatNumber"]],
      [alerts, ["jobOffers", "notifications"]],
    ];
    if (allowed.some(([section, keys]) => Object.keys(section).some((key) => !keys.includes(key)))) return accountError("Unsupported professional field.");
    const profileChanges: Record<string, unknown> = {};
    const providerChanges: Record<string, unknown> = {};
    const settings: Record<string, unknown> = { provider_id: ctx.providerId, updated_at: new Date().toISOString() };
    const onboarding: Record<string, unknown> = {};
    if ("legalName" in personal) {
      const name = optionalText(personal.legalName, 160);
      if (!name) return accountError("Enter your legal name.");
      profileChanges.full_name = name;
    }
    if ("phone" in personal) {
      const phone = normaliseGbPhone(personal.phone);
      if (!phone) return accountError("Enter your UK phone number.");
      profileChanges.phone = phone;
    }
    if ("homePostcode" in personal) {
      const postcode = optionalText(personal.homePostcode, 12)?.toUpperCase() ?? null;
      if (postcode && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(postcode)) return accountError("Enter a valid UK postcode.");
      settings.home_postcode = postcode;
    }
    if ("emergencyContactName" in personal) settings.emergency_contact_name = optionalText(personal.emergencyContactName, 160);
    if ("emergencyContactPhone" in personal) settings.emergency_contact_phone = normaliseGbPhone(personal.emergencyContactPhone);
    if ("displayName" in publicProfile) {
      const name = optionalText(publicProfile.displayName, 80);
      if (!name) return accountError("Enter a display name.");
      providerChanges.display_name = name;
    }
    if ("photoUrl" in publicProfile) providerChanges.photo_url = safeProfilePhoto(publicProfile.photoUrl);
    if ("bio" in publicProfile) providerChanges.bio = optionalText(publicProfile.bio, 1200);
    if ("yearsExperience" in publicProfile) providerChanges.years_experience = optionalInteger(publicProfile.yearsExperience, 0, 60);
    if ("languages" in publicProfile) settings.languages = textList(publicProfile.languages, 12, 40);
    if ("equipmentProvided" in publicProfile) settings.brings_equipment = optionalBoolean(publicProfile.equipmentProvided);
    if ("coveragePostcodes" in work) {
      const coverage = textList(work.coveragePostcodes, 60, 12)?.map((value) => value.toUpperCase());
      if (coverage?.some((value) => !/^(GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]{2})?)$/.test(value))) {
        return accountError("Use full postcodes or outward codes such as SW3.");
      }
      settings.coverage_postcodes = coverage;
    }
    if ("maxTravelMiles" in work) settings.max_travel_miles = optionalInteger(work.maxTravelMiles, 0, 100);
    if ("maxDailyHours" in work) settings.max_daily_hours = optionalInteger(work.maxDailyHours, 1, 16);
    if ("acceptsSameDay" in work) settings.accepts_same_day = optionalBoolean(work.acceptsSameDay);
    if ("utrNumber" in tax) {
      const utr = optionalText(tax.utrNumber, 10);
      if (utr && !/^\d{10}$/.test(utr)) return accountError("UTR must contain 10 digits.");
      onboarding.utr_number = utr;
    }
    if ("vatNumber" in tax) {
      const vat = optionalText(tax.vatNumber, 20)?.toUpperCase() ?? null;
      if (vat && !/^(GB)?\d{9}$/.test(vat)) return accountError("Enter a valid UK VAT number.");
      settings.vat_number = vat;
    }
    if ("jobOffers" in alerts) {
      if (!isRecord(alerts.jobOffers)) return accountError("Choose valid job alerts.");
      if ("app" in alerts.jobOffers) settings.alert_app = optionalBoolean(alerts.jobOffers.app);
      if ("sms" in alerts.jobOffers) settings.alert_sms = optionalBoolean(alerts.jobOffers.sms);
      if ("email" in alerts.jobOffers) settings.alert_email = optionalBoolean(alerts.jobOffers.email);
    }
    if ("notifications" in alerts) {
      if (!isRecord(alerts.notifications)) return accountError("Choose valid notifications.");
      if ("messages" in alerts.notifications) settings.notify_messages = optionalBoolean(alerts.notifications.messages);
    }
    const rates = publicProfile.handymanRates;
    if (rates !== undefined) {
      if (!isRecord(rates) || Object.keys(rates).some((task) => !HANDYMAN_TASKS.includes(task) || typeof rates[task] !== "number" || !Number.isFinite(rates[task]) || Number(rates[task]) < 1 || Number(rates[task]) > 1000)) {
        return accountError("Enter valid hourly rates for the listed handyman tasks.");
      }
      const { data: provider } = await ctx.admin.from("providers").select("services").eq("id", ctx.providerId!).single();
      if (!provider?.services?.includes("handyman")) return accountError("Handyman rates are available to approved handyman providers only.", 403);
    }
    if (Object.keys(profileChanges).length) {
      const { error } = await ctx.admin.from("profiles").update(profileChanges).eq("id", ctx.user.id);
      if (error) return accountError("Personal details could not be saved.", 503);
    }
    if (Object.keys(providerChanges).length) {
      const { error } = await ctx.admin.from("providers").update(providerChanges).eq("id", ctx.providerId!);
      if (error) return accountError("Public profile could not be saved.", 503);
    }
    if (Object.keys(settings).length > 2) {
      const { error } = await ctx.admin.from("provider_profile_settings").upsert(settings, { onConflict: "provider_id" });
      if (error) return accountError("Professional settings could not be saved.", 503);
    }
    if (Object.keys(onboarding).length) {
      const { error } = await ctx.admin.from("provider_onboarding_details").update(onboarding).eq("provider_id", ctx.providerId!);
      if (error) return accountError("Tax details could not be saved.", 503);
    }
    if (isRecord(rates)) {
      for (const [task, amount] of Object.entries(rates)) {
        const { error } = await ctx.admin.from("provider_task_rates").upsert({ provider_id: ctx.providerId, task_name: task, hourly_rate_pence: Math.round(Number(amount) * 100), updated_at: new Date().toISOString() }, { onConflict: "provider_id,task_name" });
        if (error) return accountError("A handyman rate could not be saved.", 503);
      }
    }
    return NextResponse.json(await loadWorkerProfile(ctx));
  } catch (error) {
    return accountError(error instanceof Error ? error.message : "Invalid professional details.");
  }
}
