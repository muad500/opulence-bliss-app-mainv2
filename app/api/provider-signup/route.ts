// Provider sign-up — creates the account, profile, provider record,
// coverage areas and default hours in one go.
// Save at: app/api/provider-signup/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { handymanEnabled, validHandymanTask } from "@/lib/handymanMarketplace";
import { selectedProfessionalServices } from "@/lib/professionalServices";
import { isSameOriginMutation } from "@/lib/accountApi";
import { isValidUkPhone, normalizeUkPhone } from "@/lib/ukPhone";
import { LEGAL_VERSIONS } from "@/lib/legal";
import {
  dbsCertificateExtension,
  isDbsCertificateNumber,
  isDbsIssueDate,
  normalizeDbsCertificateNumber,
} from "@/lib/providerDbs";
import {
  canFinalizeProviderPartnership,
  isProviderCleaningExperienceTypes,
  isProviderCleaningExperienceYears,
  isOptionalUtrNumber,
  isProviderResidentStatus,
  isStrongProviderPassword,
  isProviderTravelDistance,
  isProviderWeeklyAvailability,
  isProviderWeeklyHours,
  providerAvailabilityRows,
  providerApplicationEligibilityError,
} from "@/lib/providerOnboarding";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginMutation(req))
      return NextResponse.json(
        { error: "This request must come from the website." },
        { status: 403 },
      );
    const signedIn = await createServerClient();
    const {
      data: { user: existingUser },
    } = await signedIn.auth.getUser();
    const {
      fullName,
      salutation,
      firstName,
      lastName,
      email,
      password,
      phone,
      address,
      dateOfBirth,
      weeklyHours,
      residentStatus,
      utrNumber,
      selfEmployed,
      rightToWork,
      currentlySelfEmployed,
      currentSelfEmploymentDetail,
      businessName,
      cleaningExperienceYears,
      cleaningExperienceTypes,
      otherCleaningExperience,
      maxTravelDistance,
      weeklyAvailability,
      skills,
      handymanRates,
      coveragePostcodes,
      homePostcode,
      areaIds,
      professionalAgreementAccepted,
      dbsCertificateNumber,
      dbsIssueDate,
      dbsCertificateFileName,
      dbsCertificateMimeType,
    } = await req.json();
    const selectedServices = selectedProfessionalServices(
      skills,
      handymanEnabled(),
    );
    if (!selectedServices)
      return NextResponse.json(
        { error: "Choose an available professional service." },
        { status: 400 },
      );
    const cleaningSelected = selectedServices.includes("cleaning");
    const handymanSelected = selectedServices.includes("handyman");
    if (
      handymanSelected &&
      (!handymanRates ||
        typeof handymanRates !== "object" ||
        Array.isArray(handymanRates) ||
        !Object.keys(handymanRates).length ||
        Object.entries(handymanRates).some(
          ([task, amount]) =>
            !validHandymanTask(task) ||
            !Number.isInteger(amount) ||
            Number(amount) < 100 ||
            Number(amount) > 100000,
        ))
    )
      return NextResponse.json(
        { error: "Select at least one handyman task and a valid hourly rate." },
        { status: 400 },
      );
    if (
      handymanSelected &&
      (!Array.isArray(coveragePostcodes) ||
        !coveragePostcodes.length ||
        coveragePostcodes.length > 60 ||
        coveragePostcodes.some(
          (code) =>
            typeof code !== "string" ||
            !/^[A-Z]{1,2}\d[A-Z\d]?(?: \d[A-Z]{2})?$/.test(code),
        ))
    )
      return NextResponse.json(
        { error: "Enter the postcodes or outward codes you cover." },
        { status: 400 },
      );
    if (
      homePostcode != null &&
      homePostcode !== "" &&
      (typeof homePostcode !== "string" ||
        !/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(homePostcode))
    )
      return NextResponse.json(
        { error: "Enter a valid home postcode." },
        { status: 400 },
      );
    const normalizedEmail = String(email ?? "")
      .trim()
      .toLowerCase();
    const normalizedPhone = normalizeUkPhone(phone);

    if (
      !email ||
      (!existingUser && !password) ||
      !fullName ||
      !salutation ||
      !firstName ||
      !lastName ||
      !phone ||
      !address ||
      !dateOfBirth ||
      !residentStatus
    ) {
      return NextResponse.json(
        { error: "Complete every account field before continuing." },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (existingUser && existingUser.email?.toLowerCase() !== normalizedEmail) {
      return NextResponse.json(
        { error: "Use the email address on your signed-in account." },
        { status: 403 },
      );
    }
    if (existingUser) {
      const { data: existingProfile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", existingUser.id)
        .maybeSingle();
      if (!existingProfile || existingProfile.role === "admin")
        return NextResponse.json(
          { error: "This account cannot apply as a professional." },
          { status: 403 },
        );
      const { data: alreadyProfessional } = await admin
        .from("providers")
        .select("id")
        .eq("profile_id", existingUser.id)
        .maybeSingle();
      if (alreadyProfessional)
        return NextResponse.json(
          {
            error:
              "Your professional account already exists. Open the professional portal.",
          },
          { status: 409 },
        );
    }
    if (!["miss", "mrs", "mr"].includes(String(salutation))) {
      return NextResponse.json(
        { error: "Select Miss, Mrs or Mr." },
        { status: 400 },
      );
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(dateOfBirth)) ||
      Number.isNaN(Date.parse(`${dateOfBirth}T00:00:00Z`)) ||
      new Date(`${dateOfBirth}T00:00:00Z`) > new Date()
    ) {
      return NextResponse.json(
        { error: "Enter a valid date of birth." },
        { status: 400 },
      );
    }
    const eighteenthBirthday = new Date(`${dateOfBirth}T00:00:00Z`);
    eighteenthBirthday.setUTCFullYear(eighteenthBirthday.getUTCFullYear() + 18);
    if (eighteenthBirthday > new Date()) {
      return NextResponse.json(
        { error: "You must be at least 18 to apply." },
        { status: 400 },
      );
    }
    if (!isValidUkPhone(phone)) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 },
      );
    }
    if (!isProviderWeeklyHours(weeklyHours)) {
      return NextResponse.json(
        { error: "Weekly availability must be between 0 and 40 hours." },
        { status: 400 },
      );
    }
    if (!isProviderResidentStatus(residentStatus)) {
      return NextResponse.json(
        { error: "Select a valid resident status in the UK." },
        { status: 400 },
      );
    }
    const eligibilityError = providerApplicationEligibilityError(
      residentStatus,
      rightToWork,
    );
    if (eligibilityError)
      return NextResponse.json({ error: eligibilityError }, { status: 400 });
    if (!isOptionalUtrNumber(utrNumber)) {
      return NextResponse.json(
        { error: "The UTR number must contain 10 digits, or be left blank." },
        { status: 400 },
      );
    }
    if (!canFinalizeProviderPartnership(selfEmployed)) {
      return NextResponse.json(
        {
          error:
            "Opulence Bliss can only partner with self-employed professionals.",
        },
        { status: 400 },
      );
    }
    if (typeof rightToWork !== "boolean") {
      return NextResponse.json(
        {
          error:
            "Tell us whether you currently have the right to work in the UK.",
        },
        { status: 400 },
      );
    }
    if (!["yes", "no", "other"].includes(String(currentlySelfEmployed))) {
      return NextResponse.json(
        { error: "Tell us whether you are currently self-employed." },
        { status: 400 },
      );
    }
    if (
      currentlySelfEmployed === "other" &&
      !String(currentSelfEmploymentDetail ?? "").trim()
    ) {
      return NextResponse.json(
        { error: "Describe your current self-employment status." },
        { status: 400 },
      );
    }
    if (
      businessName != null &&
      (typeof businessName !== "string" || businessName.trim().length > 160)
    ) {
      return NextResponse.json(
        {
          error:
            "Keep your trading or business name under 160 characters, or leave it blank.",
        },
        { status: 400 },
      );
    }
    if (
      cleaningSelected &&
      !isProviderCleaningExperienceYears(cleaningExperienceYears)
    ) {
      return NextResponse.json(
        { error: "Enter your years of cleaning experience." },
        { status: 400 },
      );
    }
    if (
      cleaningSelected &&
      !isProviderCleaningExperienceTypes(cleaningExperienceTypes)
    ) {
      return NextResponse.json(
        { error: "Select at least one valid type of cleaning experience." },
        { status: 400 },
      );
    }
    if (
      cleaningSelected &&
      cleaningExperienceTypes.includes("Other") &&
      !String(otherCleaningExperience ?? "").trim()
    ) {
      return NextResponse.json(
        { error: "Describe your other cleaning experience." },
        { status: 400 },
      );
    }
    if (!isProviderTravelDistance(maxTravelDistance)) {
      return NextResponse.json(
        { error: "Select the maximum distance you can travel." },
        { status: 400 },
      );
    }
    if (!isProviderWeeklyAvailability(weeklyAvailability)) {
      return NextResponse.json(
        {
          error:
            "Choose your availability for every day and include at least one working period.",
        },
        { status: 400 },
      );
    }
    if (!Array.isArray(areaIds) || areaIds.length === 0) {
      return NextResponse.json(
        { error: "Pick at least one area you cover." },
        { status: 400 },
      );
    }
    if (!existingUser && !isStrongProviderPassword(password)) {
      return NextResponse.json(
        {
          error:
            "Password must have at least 8 characters, including uppercase, lowercase, a number and a symbol.",
        },
        { status: 400 },
      );
    }
    if (professionalAgreementAccepted !== true) {
      return NextResponse.json(
        {
          error:
            "Accept the Service Professional Partner Agreement and Privacy Policy to continue.",
        },
        { status: 400 },
      );
    }

    const dbsNumber = normalizeDbsCertificateNumber(dbsCertificateNumber);
    const dbsExtension = dbsCertificateExtension(
      dbsCertificateFileName,
      dbsCertificateMimeType,
    );
    if (!isDbsCertificateNumber(dbsNumber)) {
      return NextResponse.json(
        { error: "Enter the 12-digit DBS certificate number." },
        { status: 400 },
      );
    }
    if (!isDbsIssueDate(dbsIssueDate)) {
      return NextResponse.json(
        { error: "Enter a valid DBS certificate issue date." },
        { status: 400 },
      );
    }
    if (!dbsExtension) {
      return NextResponse.json(
        { error: "Upload the DBS certificate as a PDF, JPG or PNG file." },
        { status: 400 },
      );
    }

    const { data: legalRows } = await admin
      .from("legal_documents")
      .select("slug, version")
      .in("slug", ["professional-partner-agreement", "privacy"])
      .eq("published", true);
    const agreementRow = legalRows?.find(
      (row) => row.slug === "professional-partner-agreement",
    );
    const privacyRow = legalRows?.find((row) => row.slug === "privacy");
    const professionalAgreementVersion =
      agreementRow?.version ?? LEGAL_VERSIONS["professional-partner-agreement"];
    const privacyVersion = privacyRow?.version ?? LEGAL_VERSIONS.privacy;

    // Existing clients keep their account and can apply as a professional.
    const acceptedAt = new Date().toISOString();
    let userId = existingUser?.id;
    if (!userId) {
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
          user_metadata: {
            salutation,
            first_name: firstName,
            last_name: lastName,
            address,
            date_of_birth: dateOfBirth,
            professional_agreement_accepted: true,
            professional_agreement_version: professionalAgreementVersion,
            professional_agreement_accepted_at: acceptedAt,
            legal_accepted: true,
            legal_versions: {
              "professional-partner-agreement": professionalAgreementVersion,
              privacy: privacyVersion,
            },
            legal_accepted_at: acceptedAt,
          },
        });
      if (createErr || !created.user) {
        const msg = createErr?.message ?? "Could not create the account.";
        const already = /already|exists|registered/i.test(msg);
        return NextResponse.json(
          {
            error: already
              ? "An account with that email already exists — log in instead."
              : msg,
          },
          { status: 400 },
        );
      }
      userId = created.user.id;
    } else {
      const { error: metadataError } = await admin.auth.admin.updateUserById(
        userId,
        {
          user_metadata: {
            ...existingUser!.user_metadata,
            professional_agreement_accepted: true,
            professional_agreement_version: professionalAgreementVersion,
            professional_agreement_accepted_at: acceptedAt,
          },
        },
      );
      if (metadataError)
        return NextResponse.json(
          { error: "Could not save agreement acceptance." },
          { status: 503 },
        );
    }

    // New professional accounts retain the legacy provider role; existing
    // client profiles keep their role and gain professional membership below.
    const profileRecord = {
      id: userId,
      email: normalizedEmail,
      ...(!existingUser ? { role: "provider" } : {}),
      full_name: fullName,
      phone: normalizedPhone,
      address,
    };
    const { error: profileError } = await admin
      .from("profiles")
      .upsert(profileRecord, { onConflict: "id" });
    if (profileError)
      return NextResponse.json(
        { error: "Could not save your personal details." },
        { status: 503 },
      );
    await admin
      .from("account_legal_acceptances")
      .upsert(
        {
          user_id: userId,
          document_slug: "professional-partner-agreement",
          version: professionalAgreementVersion,
          accepted_at: acceptedAt,
        },
        { onConflict: "user_id,document_slug,version" },
      );

    // 3. Provider record — work access begins after the admin approves it.
    const { data: prov, error: provErr } = await admin
      .from("providers")
      .insert({
        profile_id: userId,
        services: selectedServices,
        display_name: fullName,
        years_experience: cleaningSelected ? cleaningExperienceYears : 0,
        vetting_status: "pending",
      })
      .select("id")
      .single();

    if (provErr || !prov) {
      return NextResponse.json(
        { error: provErr?.message ?? "Could not create the provider record." },
        { status: 500 },
      );
    }

    const dbsStoragePath = `${prov.id}/certificate.${dbsExtension}`;
    const dbsMimeType =
      dbsExtension === "pdf"
        ? "application/pdf"
        : dbsExtension === "png"
          ? "image/png"
          : "image/jpeg";
    const { error: dbsError } = await admin.from("provider_dbs_checks").insert({
      provider_id: prov.id,
      certificate_number: dbsNumber,
      issue_date: String(dbsIssueDate),
      certificate_storage_path: dbsStoragePath,
      certificate_original_name: String(
        dbsCertificateFileName ?? "certificate",
      ).slice(0, 240),
      certificate_mime_type: dbsMimeType,
      status: "pending",
    });
    if (dbsError) {
      return NextResponse.json(
        { error: dbsError.message || "Could not save the DBS details." },
        { status: 500 },
      );
    }

    // 4. Private onboarding details for application review.
    const { error: onboardingErr } = await admin
      .from("provider_onboarding_details")
      .insert({
        provider_id: prov.id,
        preferred_weekly_hours: weeklyHours,
        resident_status: residentStatus,
        utr_number:
          typeof utrNumber === "string" ? utrNumber.trim() || null : null,
        self_employed_confirmed: true,
        salutation,
        date_of_birth: dateOfBirth,
        right_to_work: rightToWork,
        current_self_employment_status: currentlySelfEmployed,
        current_self_employment_detail:
          currentlySelfEmployed === "other"
            ? String(currentSelfEmploymentDetail).trim()
            : null,
        business_name:
          typeof businessName === "string" ? businessName.trim() || null : null,
        cleaning_experience_years: cleaningSelected
          ? cleaningExperienceYears
          : null,
        cleaning_experience_types: cleaningSelected
          ? cleaningExperienceTypes
          : [],
        other_cleaning_experience:
          cleaningSelected && cleaningExperienceTypes.includes("Other")
            ? String(otherCleaningExperience).trim()
            : null,
        max_travel_distance: maxTravelDistance,
        weekly_availability: weeklyAvailability,
      });

    if (onboardingErr) {
      return NextResponse.json(
        {
          error:
            onboardingErr.message ||
            "Could not save the professional onboarding details.",
        },
        { status: 500 },
      );
    }

    const { error: settingsError } = await admin
      .from("provider_profile_settings")
      .upsert(
        {
          provider_id: prov.id,
          home_postcode: homePostcode || null,
          coverage_postcodes: handymanSelected ? coveragePostcodes : [],
          availability_configured: true,
        },
        { onConflict: "provider_id" },
      );
    if (settingsError)
      return NextResponse.json(
        { error: "Could not save shared work settings." },
        { status: 503 },
      );
    if (handymanSelected) {
      const { error: ratesError } = await admin
        .from("provider_task_rates")
        .insert(
          Object.entries(handymanRates).map(([task, amount]) => ({
            provider_id: prov.id,
            task_name: task,
            hourly_rate_pence: amount,
          })),
        );
      if (ratesError)
        return NextResponse.json(
          { error: "Could not save your handyman tasks." },
          { status: 503 },
        );
    }
    // 5. Coverage areas.
    await admin.from("provider_service_areas").insert(
      (areaIds as string[]).map((id) => ({
        provider_id: prov.id,
        service_area_id: id,
      })),
    );

    // 6. Publish the applicant's selected periods as their initial matching hours.
    await admin.from("provider_availability").insert(
      providerAvailabilityRows(weeklyAvailability).map((row) => ({
        provider_id: prov.id,
        ...row,
      })),
    );

    return NextResponse.json({
      ok: true,
      userId,
      providerId: prov.id,
      dbsStoragePath,
      dbsMimeType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sign-up failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
