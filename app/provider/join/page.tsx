"use client";

// Become a provider — sign up, then complete the approval process.
// Save at: app/provider/join/page.tsx  →  localhost:3000/provider/join

import { useEffect, useState } from "react";
import ProfessionalServicePicker from "@/components/ProfessionalServicePicker";
import { HANDYMAN_TASKS } from "@/lib/handymanMarketplace";
import type { ProfessionalService } from "@/lib/professionalServices";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isValidUkPhone } from "@/lib/ukPhone";
import {
  DBS_CERTIFICATE_ACCEPT,
  DBS_CERTIFICATE_MAX_BYTES,
  isDbsCertificateNumber,
  isDbsIssueDate,
  isSupportedDbsCertificate,
  normalizeDbsCertificateNumber,
} from "@/lib/providerDbs";
import { PRIVACY_URL, PROFESSIONAL_PARTNER_AGREEMENT_URL } from "@/lib/legal";
import {
  estimateProviderMonthlyEarnings,
  isOptionalUtrNumber,
  providerApplicationEligibilityError,
  isStrongProviderPassword,
  PROVIDER_AVAILABILITY_PERIODS,
  PROVIDER_CLEANING_EXPERIENCE_TYPES,
  PROVIDER_ESTIMATED_HOURLY_EARNINGS,
  PROVIDER_MAX_WEEKLY_HOURS,
  PROVIDER_RESIDENT_STATUSES,
  PROVIDER_TRAVEL_DISTANCES,
  PROVIDER_WEEKDAYS,
  type ProviderAvailabilityPeriod,
  type ProviderWeeklyAvailability,
} from "@/lib/providerOnboarding";

const supabase = createClient();

type Area = { id: string; name: string; postcode_prefixes: string[] };

type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  recipient_name: string;
  recipient_type: "professional" | "client";
};

type JoinStep =
  | "estimate"
  | "account"
  | "status"
  | "experience"
  | "work"
  | "availability"
  | "dbs";

const INITIAL_WEEKLY_AVAILABILITY: ProviderWeeklyAvailability = {
  monday: "unavailable",
  tuesday: "unavailable",
  wednesday: "unavailable",
  thursday: "unavailable",
  friday: "unavailable",
  saturday: "unavailable",
  sunday: "unavailable",
};

const AVAILABILITY_LABELS: Record<ProviderAvailabilityPeriod, string> = {
  unavailable: "Off",
  all_day: "Day",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export default function ProviderJoinPage() {
  const [existingUserId, setExistingUserId] = useState<string | null>(null);
  const [alreadyProfessional, setAlreadyProfessional] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [joinStep, setJoinStep] = useState<JoinStep>("estimate");
  const [weeklyHours, setWeeklyHours] = useState(30);
  const [salutation, setSalutation] = useState<"miss" | "mrs" | "mr" | "">("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [triedNext, setTriedNext] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [residentStatus, setResidentStatus] = useState("");
  const [utrNumber, setUtrNumber] = useState("");
  const [rightToWork, setRightToWork] = useState<"yes" | "no" | "">("");
  const [selfEmployed, setSelfEmployed] = useState<"agree" | "disagree" | "">(
    "",
  );
  const [currentlySelfEmployed, setCurrentlySelfEmployed] = useState<
    "yes" | "no" | "other" | ""
  >("");
  const [currentSelfEmploymentDetail, setCurrentSelfEmploymentDetail] =
    useState("");
  const [businessName, setBusinessName] = useState("");
  const [cleaningExperienceYears, setCleaningExperienceYears] = useState("");
  const [cleaningExperienceTypes, setCleaningExperienceTypes] = useState<
    string[]
  >([]);
  const [otherCleaningExperience, setOtherCleaningExperience] = useState("");
  const [maxTravelDistance, setMaxTravelDistance] = useState("");
  const [weeklyAvailability, setWeeklyAvailability] =
    useState<ProviderWeeklyAvailability>(INITIAL_WEEKLY_AVAILABILITY);
  const [skills, setSkills] = useState<ProfessionalService[]>(["cleaning"]);
  const [marketplaceEnabled, setMarketplaceEnabled] = useState(false);
  const [handymanRates, setHandymanRates] = useState<Record<string, string>>(
    {},
  );
  const [coveragePostcodes, setCoveragePostcodes] = useState("");
  const [homePostcode, setHomePostcode] = useState("");
  const cleaningSelected = skills.includes("cleaning");
  const handymanSelected = marketplaceEnabled && skills.includes("handyman");
  const validRates =
    !handymanSelected ||
    (Object.keys(handymanRates).length > 0 &&
      Object.values(handymanRates).every(
        (rate) => Number(rate) >= 1 && Number(rate) <= 1000,
      ));
  useEffect(() => {
    let active = true;
    void fetch("/api/handyman/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config) => {
        if (!active) return;
        const enabled = config.enabled === true;
        setMarketplaceEnabled(enabled);
        if (
          enabled &&
          new URLSearchParams(window.location.search).get("service") ===
            "handyman"
        )
          setSkills(["handyman"]);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [professionalAgreementAccepted, setProfessionalAgreementAccepted] =
    useState(false);
  const [dbsCertificateNumber, setDbsCertificateNumber] = useState("");
  const [dbsIssueDate, setDbsIssueDate] = useState("");
  const [dbsCertificate, setDbsCertificate] = useState<File | null>(null);
  const [createdApplication, setCreatedApplication] = useState<{
    userId: string;
    providerId: string;
    dbsStoragePath: string;
    dbsMimeType: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const [{ data: profile }, { data: provider }] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name,phone,address")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("providers")
          .select("id")
          .eq("profile_id", user.id)
          .maybeSingle(),
      ]);
      if (!active) return;
      setExistingUserId(user.id);
      setAlreadyProfessional(!!provider);
      setEmail(user.email ?? "");
      const name = String(profile?.full_name ?? "")
        .trim()
        .split(/\s+/);
      setFirstName(
        (old) => old || String(user.user_metadata?.first_name ?? name[0] ?? ""),
      );
      setLastName(
        (old) =>
          old ||
          String(
            user.user_metadata?.last_name ?? name.slice(1).join(" ") ?? "",
          ),
      );
      setPhone((old) => old || profile?.phone || "");
      setAddress((old) => old || profile?.address || "");
      setSalutation(
        (old) =>
          old ||
          (user.user_metadata?.salutation as "miss" | "mrs" | "mr") ||
          "",
      );
      setDateOfBirth(
        (old) => old || String(user.user_metadata?.date_of_birth ?? ""),
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("service_areas")
        .select("id, name, postcode_prefixes")
        .eq("active", true);
      setAreas(data ?? []);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("public_reviews_feed", {
        p_limit: 24,
      });
      const list = ((data ?? []) as PublicReview[])
        .filter((review) => review.recipient_type === "professional")
        .slice(0, 3);
      setReviews(list);
    })();
  }, []);

  function toggle(list: string[], v: string) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const emailValid = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email.trim());
  const phoneValid = isValidUkPhone(phone);
  const passwordChecks = {
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
    length: password.length >= 8,
  };
  const passwordValid = isStrongProviderPassword(password);
  function yearsSince(iso: string) {
    if (!iso) return null;
    const born = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(born.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const monthDiff = now.getMonth() - born.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) {
      age -= 1;
    }
    return age;
  }
  const age = yearsSince(dateOfBirth);
  const dobValid = age !== null && age >= 18 && age < 100;
  const showFieldError = (field: string) =>
    Boolean(touched[field] || triedNext);
  const markTouched = (field: string) =>
    setTouched((current) => ({ ...current, [field]: true }));
  const accountFieldsPresent = Boolean(
    salutation &&
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    (existingUserId || passwordValid) &&
    phone.trim() &&
    address.trim() &&
    dateOfBirth,
  );
  const accountReady = Boolean(
    accountFieldsPresent && emailValid && phoneValid && dobValid,
  );

  function continueToWorkDetails() {
    setEmailTouched(true);
    setPhoneTouched(true);
    setTriedNext(true);
    if (!accountReady) {
      setErr(null);
      return;
    }
    setErr(null);
    setJoinStep("status");
  }

  function continueToExperience() {
    if (!rightToWork) {
      setErr("Tell us whether you currently have the right to work in the UK.");
      return;
    }
    if (!residentStatus) {
      setErr("Select your resident status in the UK.");
      return;
    }
    const eligibilityError = providerApplicationEligibilityError(
      residentStatus,
      rightToWork === "yes",
    );
    if (eligibilityError) {
      setErr(eligibilityError);
      return;
    }
    if (selfEmployed !== "agree") {
      setErr("You must agree to work as self-employed to continue.");
      return;
    }
    if (!isOptionalUtrNumber(utrNumber)) {
      setErr("Enter all 10 digits of your UTR number, or leave it blank.");
      return;
    }
    if (!currentlySelfEmployed) {
      setErr("Tell us whether you are currently self-employed.");
      return;
    }
    if (
      currentlySelfEmployed === "other" &&
      !currentSelfEmploymentDetail.trim()
    ) {
      setErr("Describe your current self-employment status.");
      return;
    }
    setErr(null);
    setJoinStep("experience");
  }

  function continueToWorkAreas() {
    if (!skills.length || !validRates) {
      setErr(
        "Choose a service and at least one valid hourly rate for handyman work.",
      );
      return;
    }
    const years = Number(cleaningExperienceYears);
    if (
      cleaningSelected &&
      (!cleaningExperienceYears ||
        !Number.isInteger(years) ||
        years < 0 ||
        years > 60)
    ) {
      setErr("Enter your years of cleaning experience between 0 and 60.");
      return;
    }
    if (cleaningSelected && cleaningExperienceTypes.length === 0) {
      setErr("Select at least one type of cleaning experience.");
      return;
    }
    if (
      cleaningSelected &&
      cleaningExperienceTypes.includes("Other") &&
      !otherCleaningExperience.trim()
    ) {
      setErr("Describe your other cleaning experience.");
      return;
    }
    setErr(null);
    setJoinStep("work");
  }

  function continueToAvailability() {
    if (handymanSelected && !coveragePostcodes.trim()) {
      setErr("Enter the postcodes or outward codes you cover.");
      return;
    }
    if (areaIds.length === 0) {
      setErr("Pick at least one area of London you cover.");
      return;
    }
    if (!maxTravelDistance) {
      setErr("Select the maximum distance you can travel.");
      return;
    }
    setErr(null);
    setJoinStep("availability");
  }

  function continueToDbs() {
    if (!hasWorkingPeriod) {
      setErr("Choose at least one working period before continuing.");
      return;
    }
    if (
      !Number.isInteger(weeklyHours) ||
      weeklyHours < 0 ||
      weeklyHours > PROVIDER_MAX_WEEKLY_HOURS
    ) {
      setErr("Weekly availability must be between 0 and 40 hours.");
      return;
    }
    setErr(null);
    setJoinStep("dbs");
  }

  async function submit() {
    const eligibilityError = providerApplicationEligibilityError(
      residentStatus,
      rightToWork === "yes",
    );
    if (eligibilityError) {
      setErr(eligibilityError);
      return;
    }
    if (!isDbsCertificateNumber(dbsCertificateNumber)) {
      setErr("Enter the 12-digit DBS certificate number.");
      return;
    }
    if (!isDbsIssueDate(dbsIssueDate)) {
      setErr("Enter a valid DBS certificate issue date.");
      return;
    }
    if (
      !dbsCertificate ||
      !isSupportedDbsCertificate(
        dbsCertificate.name,
        dbsCertificate.type,
        dbsCertificate.size,
      )
    ) {
      setErr("Upload a PDF, JPG or PNG DBS certificate no larger than 8 MB.");
      return;
    }
    if (!professionalAgreementAccepted) {
      setErr(
        "Accept the Service Professional Partner Agreement and Privacy Policy to continue.",
      );
      return;
    }
    setBusy(true);
    setErr(null);

    try {
      // 1. Create the provider account and its private DBS review record.
      let application = createdApplication;
      if (!application) {
        setStep(
          existingUserId
            ? "Saving your professional application…"
            : "Creating your account…",
        );
        const res = await fetch("/api/provider-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName,
            salutation,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            password: existingUserId ? undefined : password,
            phone: phone.trim(),
            address: address.trim(),
            dateOfBirth,
            weeklyHours,
            residentStatus,
            utrNumber: utrNumber.trim() || null,
            selfEmployed: selfEmployed === "agree",
            rightToWork: rightToWork === "yes",
            currentlySelfEmployed,
            currentSelfEmploymentDetail:
              currentSelfEmploymentDetail.trim() || null,
            businessName: businessName.trim() || null,
            cleaningExperienceYears: Number(cleaningExperienceYears),
            cleaningExperienceTypes,
            otherCleaningExperience: otherCleaningExperience.trim() || null,
            maxTravelDistance,
            weeklyAvailability,
            skills,
            handymanRates: Object.fromEntries(
              Object.entries(handymanRates)
                .filter(([, rate]) => rate !== "")
                .map(([task, rate]) => [task, Math.round(Number(rate) * 100)]),
            ),
            coveragePostcodes: coveragePostcodes
              .split(",")
              .map((code) => code.trim().toUpperCase())
              .filter(Boolean),
            homePostcode: homePostcode.trim().toUpperCase(),
            areaIds,
            professionalAgreementAccepted,
            dbsCertificateNumber:
              normalizeDbsCertificateNumber(dbsCertificateNumber),
            dbsIssueDate,
            dbsCertificateFileName: dbsCertificate.name,
            dbsCertificateMimeType: dbsCertificate.type,
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Sign-up failed");
        application = {
          userId: String(data.userId),
          providerId: String(data.providerId),
          dbsStoragePath: String(data.dbsStoragePath),
          dbsMimeType: String(data.dbsMimeType),
        };
        setCreatedApplication(application);
      }

      // 2. Sign them in
      setStep("Signing you in…");
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user.id !== application.userId) {
        if (existingUserId)
          throw new Error(
            "Your session expired. Sign in again and contact support to resume your application.",
          );
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr) throw new Error(signInErr.message);
      }

      // 3. Upload directly to the applicant's private storage folder.
      setStep("Uploading your DBS certificate…");
      const { error: uploadError } = await supabase.storage
        .from("provider-dbs")
        .upload(application.dbsStoragePath, dbsCertificate, {
          contentType: application.dbsMimeType,
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { error: uploadedError } = await supabase
        .from("provider_dbs_checks")
        .update({ uploaded_at: new Date().toISOString() })
        .eq("provider_id", application.providerId)
        .eq("status", "pending");
      if (uploadedError) throw new Error(uploadedError.message);

      // 4. No joining payment: continue directly to the provider portal.
      setStep("Opening your provider portal…");
      window.location.href = "/worker/application";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
      setStep("");
    }
  }

  const hasWorkingPeriod = Object.values(weeklyAvailability).some(
    (period) => period !== "unavailable",
  );
  const ready = Boolean(
    accountReady &&
    rightToWork === "yes" &&
    residentStatus &&
    !providerApplicationEligibilityError(residentStatus, true) &&
    selfEmployed === "agree" &&
    currentlySelfEmployed &&
    (!cleaningSelected ||
      (cleaningExperienceYears !== "" && cleaningExperienceTypes.length > 0)) &&
    validRates &&
    skills.length &&
    areaIds.length &&
    maxTravelDistance &&
    hasWorkingPeriod &&
    isDbsCertificateNumber(dbsCertificateNumber) &&
    isDbsIssueDate(dbsIssueDate) &&
    dbsCertificate &&
    isSupportedDbsCertificate(
      dbsCertificate.name,
      dbsCertificate.type,
      dbsCertificate.size,
    ) &&
    professionalAgreementAccepted,
  );
  const monthlyEstimate = estimateProviderMonthlyEarnings(weeklyHours);

  return (
    <main className="wrap">
      <div className="grid">
        {/* ---- Page introduction ---- */}
        <section className="pitch">
          <h1>Good work, fair pay, your own hours</h1>
        </section>

        {/* ---- In-page application ---- */}
        <section
          className={`form ${joinStep === "estimate" ? "estimate-mode" : "application-mode"}`}
        >
          <div className="form-surface">
            {joinStep === "estimate" && (
              <div className="estimate-step">
                <ProfessionalServicePicker
                  value={skills}
                  onChange={setSkills}
                  handymanEnabled={marketplaceEnabled}
                />
                <div className="availability-card">
                  <div className="availability-heading">
                    <b>Your availability</b>
                    <strong>{weeklyHours}hr per week</strong>
                  </div>
                  <input
                    className="hours-slider"
                    type="range"
                    min="0"
                    max={PROVIDER_MAX_WEEKLY_HOURS}
                    step="1"
                    value={weeklyHours}
                    onChange={(event) =>
                      setWeeklyHours(Number(event.target.value))
                    }
                    aria-label="Weekly availability in hours"
                  />
                  <div className="range-labels" aria-hidden="true">
                    <span>0hr</span>
                    <span>40hr</span>
                  </div>

                  <div className="simulation">
                    <p>Your simulation</p>
                    <div>
                      <span>
                        On average
                        <strong>
                          £{PROVIDER_ESTIMATED_HOURLY_EARNINGS}/hr
                        </strong>
                      </span>
                      <span>
                        That&apos;s about
                        <strong>
                          £{monthlyEstimate.toLocaleString("en-GB")}/month
                        </strong>
                      </span>
                    </div>
                  </div>
                  <p className="estimate-note">
                    Estimate before tax, based on the hours you choose.
                  </p>
                </div>

                <button
                  className="go signup-button"
                  type="button"
                  disabled={!skills.length}
                  onClick={() =>
                    alreadyProfessional
                      ? window.location.assign("/worker/profile#services")
                      : setJoinStep("account")
                  }
                >
                  {alreadyProfessional
                    ? "Open professional portal"
                    : existingUserId
                      ? "Apply with my account"
                      : "Join for free"}
                </button>
              </div>
            )}

            {joinStep === "account" && (
              <div className="account-fields">
                <button
                  className="step-back"
                  type="button"
                  onClick={() => setJoinStep("estimate")}
                >
                  ← Back
                </button>
                <p className="form-kicker">Professional application</p>
                <h2 className="meet-heading">Personal details</h2>
                <p className="section-intro">
                  {existingUserId
                    ? "Use your current account to apply as a professional. Your client bookings stay available."
                    : "Tell us who you are to start your professional application."}
                </p>
                <fieldset className="title-options">
                  <legend className="sr-only">Title</legend>
                  <label className="title-option">
                    <input
                      type="radio"
                      name="salutation"
                      checked={salutation === "miss"}
                      onChange={() => setSalutation("miss")}
                    />
                    <span aria-hidden="true" /> Miss
                  </label>
                  <label className="title-option">
                    <input
                      type="radio"
                      name="salutation"
                      checked={salutation === "mrs"}
                      onChange={() => setSalutation("mrs")}
                    />
                    <span aria-hidden="true" /> Mrs
                  </label>
                  <label className="title-option">
                    <input
                      type="radio"
                      name="salutation"
                      checked={salutation === "mr"}
                      onChange={() => setSalutation("mr")}
                    />
                    <span aria-hidden="true" /> Mr
                  </label>
                </fieldset>
                {showFieldError("salutation") && !salutation && (
                  <p className="field-error">This information is compulsory</p>
                )}

                <label className="sr-only" htmlFor="provider-first-name">
                  First name
                </label>
                <input
                  id="provider-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                  onBlur={() => markTouched("firstName")}
                  className={
                    showFieldError("firstName") && !firstName.trim()
                      ? "invalid"
                      : undefined
                  }
                  aria-invalid={
                    showFieldError("firstName") && !firstName.trim()
                  }
                />
                {showFieldError("firstName") && !firstName.trim() && (
                  <p className="field-error">The first name is mandatory</p>
                )}

                <label className="sr-only" htmlFor="provider-last-name">
                  Last name
                </label>
                <input
                  id="provider-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  autoComplete="family-name"
                  onBlur={() => markTouched("lastName")}
                  className={
                    showFieldError("lastName") && !lastName.trim()
                      ? "invalid"
                      : undefined
                  }
                  aria-invalid={showFieldError("lastName") && !lastName.trim()}
                />
                {showFieldError("lastName") && !lastName.trim() && (
                  <p className="field-error">The last name is mandatory</p>
                )}

                <label className="sr-only" htmlFor="provider-email">
                  Email
                </label>
                <input
                  id="provider-email"
                  type="email"
                  value={email}
                  readOnly={!!existingUserId}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  placeholder="Email"
                  autoComplete="email"
                  className={
                    (emailTouched || triedNext) && !emailValid
                      ? "invalid"
                      : undefined
                  }
                  aria-invalid={(emailTouched || triedNext) && !emailValid}
                  aria-describedby={
                    (emailTouched || triedNext) && !emailValid
                      ? "provider-email-error"
                      : undefined
                  }
                />
                {(emailTouched || triedNext) && !emailValid && (
                  <p className="field-error" id="provider-email-error">
                    {email.trim() ? "Invalid email" : "Email is compulsory"}
                  </p>
                )}

                {!existingUserId && (
                  <>
                    <div
                      className={`password-field ${
                        showFieldError("password") && !passwordValid
                          ? "invalid"
                          : ""
                      }`}
                    >
                      <label className="sr-only" htmlFor="provider-password">
                        Password
                      </label>
                      <input
                        id="provider-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        autoComplete="new-password"
                        onBlur={() => markTouched("password")}
                        aria-invalid={
                          showFieldError("password") && !passwordValid
                        }
                        aria-describedby="provider-password-requirements"
                      />
                      <button
                        type="button"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() => setShowPassword((shown) => !shown)}
                      >
                        {showPassword ? (
                          <EyeOff size={20} />
                        ) : (
                          <Eye size={20} />
                        )}
                      </button>
                    </div>
                    <div
                      className="password-requirements"
                      id="provider-password-requirements"
                    >
                      <p>Must contain at least:</p>
                      <ul>
                        <li
                          className={
                            passwordChecks.uppercase
                              ? "passed"
                              : showFieldError("password")
                                ? "missing"
                                : ""
                          }
                        >
                          <b>A</b>
                          <span>Uppercase</span>
                        </li>
                        <li
                          className={
                            passwordChecks.lowercase
                              ? "passed"
                              : showFieldError("password")
                                ? "missing"
                                : ""
                          }
                        >
                          <b>a</b>
                          <span>Lowercase</span>
                        </li>
                        <li
                          className={
                            passwordChecks.digit
                              ? "passed"
                              : showFieldError("password")
                                ? "missing"
                                : ""
                          }
                        >
                          <b>123</b>
                          <span>Digit</span>
                        </li>
                        <li
                          className={
                            passwordChecks.symbol
                              ? "passed"
                              : showFieldError("password")
                                ? "missing"
                                : ""
                          }
                        >
                          <b>@!#</b>
                          <span>Symbol</span>
                        </li>
                        <li
                          className={
                            passwordChecks.length
                              ? "passed"
                              : showFieldError("password")
                                ? "missing"
                                : ""
                          }
                        >
                          <b>8+</b>
                          <span>Characters</span>
                        </li>
                      </ul>
                    </div>
                  </>
                )}

                <div
                  className={`phone-field ${(phoneTouched || triedNext) && !phoneValid ? "invalid" : ""}`}
                >
                  <svg
                    className="uk-flag"
                    viewBox="0 0 60 30"
                    role="img"
                    aria-label="United Kingdom"
                  >
                    <rect width="60" height="30" fill="#012169" />
                    <path
                      d="M0 0 60 30M60 0 0 30"
                      stroke="#fff"
                      strokeWidth="8"
                    />
                    <path
                      d="M0 0 60 30M60 0 0 30"
                      stroke="#C8102E"
                      strokeWidth="4"
                    />
                    <path d="M30 0V30M0 15H60" stroke="#fff" strokeWidth="10" />
                    <path
                      d="M30 0V30M0 15H60"
                      stroke="#C8102E"
                      strokeWidth="6"
                    />
                  </svg>
                  <span className="phone-code">+44</span>
                  <label className="sr-only" htmlFor="provider-phone">
                    Phone
                  </label>
                  <input
                    id="provider-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={() => setPhoneTouched(true)}
                    placeholder="Phone"
                    autoComplete="tel"
                    inputMode="numeric"
                    aria-invalid={(phoneTouched || triedNext) && !phoneValid}
                    aria-describedby={
                      (phoneTouched || triedNext) && !phoneValid
                        ? "provider-phone-error"
                        : undefined
                    }
                  />
                </div>
                {(phoneTouched || triedNext) && !phoneValid && (
                  <p className="field-error" id="provider-phone-error">
                    {phone.trim()
                      ? "Invalid phone number"
                      : "The phone number is compulsory"}
                  </p>
                )}

                <label className="sr-only" htmlFor="provider-address">
                  Address
                </label>
                <input
                  id="provider-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Address"
                  autoComplete="street-address"
                  onBlur={() => markTouched("address")}
                  className={
                    showFieldError("address") && !address.trim()
                      ? "invalid"
                      : undefined
                  }
                  aria-invalid={showFieldError("address") && !address.trim()}
                />
                {showFieldError("address") && !address.trim() && (
                  <p className="field-error">The address is compulsory</p>
                )}

                <label className="dob-label" htmlFor="provider-dob">
                  Date of birth
                </label>
                <input
                  id="provider-dob"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  onBlur={() => markTouched("dob")}
                  className={
                    showFieldError("dob") && !dobValid ? "invalid" : undefined
                  }
                  aria-invalid={showFieldError("dob") && !dobValid}
                />
                {showFieldError("dob") && !dobValid && (
                  <p className="field-error">
                    {!dateOfBirth
                      ? "The birthdate is compulsory"
                      : age !== null && age < 18
                        ? "You must be 18 or over to work with us"
                        : "Enter a valid date of birth"}
                  </p>
                )}

                <button
                  className="go next"
                  type="button"
                  onClick={continueToWorkDetails}
                >
                  Next
                </button>
              </div>
            )}

            {joinStep === "status" && selfEmployed !== "disagree" && (
              <div className="status-fields">
                <button
                  className="step-back"
                  type="button"
                  onClick={() => setJoinStep("account")}
                >
                  ← Back
                </button>
                <p className="form-kicker">Professional application</p>
                <h2>What&apos;s your professional status?</h2>

                <fieldset className="choice-card">
                  <legend>
                    Does your UK permission allow self-employed work?
                  </legend>
                  <div className="choice-options">
                    <label>
                      <input
                        type="radio"
                        name="right-to-work"
                        checked={rightToWork === "yes"}
                        onChange={() => setRightToWork("yes")}
                      />
                      <span aria-hidden="true" /> Yes, I do
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="right-to-work"
                        checked={rightToWork === "no"}
                        onChange={() => setRightToWork("no")}
                      />
                      <span aria-hidden="true" /> No, not yet
                    </label>
                  </div>
                </fieldset>

                <label htmlFor="provider-resident-status">
                  Resident status in the UK
                </label>
                <select
                  id="provider-resident-status"
                  value={residentStatus}
                  onChange={(event) => setResidentStatus(event.target.value)}
                >
                  <option value="" disabled>
                    Select your resident status
                  </option>
                  {PROVIDER_RESIDENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <fieldset className="choice-card">
                  <legend>Are you currently self-employed?</legend>
                  <div className="choice-options">
                    {(["yes", "no", "other"] as const).map((answer) => (
                      <label key={answer}>
                        <input
                          type="radio"
                          name="currently-self-employed"
                          checked={currentlySelfEmployed === answer}
                          onChange={() => setCurrentlySelfEmployed(answer)}
                        />
                        <span aria-hidden="true" />{" "}
                        {answer === "other"
                          ? "Other"
                          : answer === "yes"
                            ? "Yes"
                            : "No"}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {currentlySelfEmployed === "other" && (
                  <>
                    <label htmlFor="provider-self-employment-detail">
                      Tell us about your current status
                    </label>
                    <input
                      id="provider-self-employment-detail"
                      value={currentSelfEmploymentDetail}
                      onChange={(event) =>
                        setCurrentSelfEmploymentDetail(event.target.value)
                      }
                      placeholder="Describe your current work status"
                    />
                  </>
                )}

                {residentStatus &&
                  providerApplicationEligibilityError(residentStatus, true) && (
                    <p role="alert" className="help-copy">
                      {providerApplicationEligibilityError(
                        residentStatus,
                        true,
                      )}
                    </p>
                  )}
                <p className="help-copy">
                  Being a student is not itself a restriction. Your visa or
                  immigration permission must allow self-employment, and our
                  team will check your evidence before approval.
                </p>
                <label htmlFor="provider-business-name">
                  Trading or business name <span>(optional)</span>
                </label>
                <input
                  id="provider-business-name"
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  placeholder="Leave blank if you do not have one"
                  maxLength={160}
                />

                <label htmlFor="provider-utr">
                  UTR number <span>(optional)</span>
                </label>
                <input
                  id="provider-utr"
                  value={utrNumber}
                  onChange={(event) =>
                    setUtrNumber(
                      event.target.value.replace(/\D/g, "").slice(0, 10),
                    )
                  }
                  placeholder="Enter your 10-digit UTR if you have one"
                  inputMode="numeric"
                  autoComplete="off"
                />
                <p className="help-copy">
                  You can continue if you do not have a UTR number yet.
                </p>

                <div className="employment-card">
                  <h3>Partnership with Opulence Bliss</h3>
                  <p>
                    Professionals using Opulence Bliss work on a self-employed
                    basis.
                  </p>
                  <fieldset className="employment-options">
                    <legend>Do you agree to work as self-employed?</legend>
                    <label>
                      <input
                        type="radio"
                        name="self-employed"
                        checked={selfEmployed === "agree"}
                        onChange={() => setSelfEmployed("agree")}
                      />
                      <span aria-hidden="true" /> Agree
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="self-employed"
                        checked={false}
                        onChange={() => setSelfEmployed("disagree")}
                      />
                      <span aria-hidden="true" /> Disagree
                    </label>
                  </fieldset>
                </div>

                <button
                  className="go next"
                  type="button"
                  onClick={continueToExperience}
                >
                  Next
                </button>
              </div>
            )}

            {joinStep === "status" && selfEmployed === "disagree" && (
              <div className="unable-panel" role="status">
                <button
                  className="step-back"
                  type="button"
                  onClick={() => setSelfEmployed("")}
                >
                  ← Change answer
                </button>
                <div className="unable-heading">
                  <span aria-hidden="true">😥</span>
                  <h2>Unable to finalize partnership</h2>
                </div>
                <div className="unable-copy">
                  <p>
                    Opulence Bliss only works with self-employed professionals.
                  </p>
                  <p>
                    To become an Opulence Bliss partner, you must want to be
                    self-employed.
                  </p>
                  <p>
                    If you change your mind, choose “Change answer” and select
                    Agree.
                  </p>
                  <p>We look forward to hearing from you.</p>
                </div>
              </div>
            )}

            {joinStep === "experience" && (
              <div className="experience-fields">
                <button
                  className="step-back"
                  type="button"
                  onClick={() => setJoinStep("status")}
                >
                  ← Back
                </button>
                <p className="form-kicker">Professional application</p>
                <h2>Your services and experience</h2>
                <ProfessionalServicePicker
                  value={skills}
                  onChange={setSkills}
                  handymanEnabled={marketplaceEnabled}
                />
                {cleaningSelected && (
                  <>
                    <label htmlFor="provider-experience-years">
                      Years of cleaning experience
                    </label>
                    <input
                      id="provider-experience-years"
                      type="number"
                      min="0"
                      max="60"
                      step="1"
                      value={cleaningExperienceYears}
                      onChange={(event) =>
                        setCleaningExperienceYears(event.target.value)
                      }
                      placeholder="For example, 3"
                      inputMode="numeric"
                    />

                    <fieldset className="multi-card">
                      <legend>Types of cleaning experience</legend>
                      <p>Select every type that applies to you.</p>
                      <div className="multi-options">
                        {PROVIDER_CLEANING_EXPERIENCE_TYPES.map((type) => (
                          <label key={type}>
                            <input
                              type="checkbox"
                              checked={cleaningExperienceTypes.includes(type)}
                              onChange={() =>
                                setCleaningExperienceTypes((list) =>
                                  toggle(list, type),
                                )
                              }
                            />
                            <span aria-hidden="true">✓</span>
                            {type}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {cleaningExperienceTypes.includes("Other") && (
                      <>
                        <label htmlFor="provider-other-experience">
                          Other cleaning experience
                        </label>
                        <input
                          id="provider-other-experience"
                          value={otherCleaningExperience}
                          onChange={(event) =>
                            setOtherCleaningExperience(event.target.value)
                          }
                          placeholder="Tell us what kind of cleaning you have done"
                        />
                      </>
                    )}
                  </>
                )}
                {handymanSelected && (
                  <fieldset className="multi-card">
                    <legend>Handyman tasks and your hourly rates</legend>
                    <p>
                      Choose the tasks you offer. Rates are per hour before any
                      applicable VAT.
                    </p>
                    {HANDYMAN_TASKS.map((task) => (
                      <div key={task} style={{ marginBottom: 14 }}>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={task in handymanRates}
                            style={{ width: 18, height: 18 }}
                            onChange={(event) =>
                              setHandymanRates((old) => {
                                const next = { ...old };
                                if (event.target.checked) next[task] = "";
                                else delete next[task];
                                return next;
                              })
                            }
                          />
                          {task}
                        </label>
                        {task in handymanRates && (
                          <label>
                            £ per hour
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              step="0.01"
                              value={handymanRates[task]}
                              onChange={(event) =>
                                setHandymanRates((old) => ({
                                  ...old,
                                  [task]: event.target.value,
                                }))
                              }
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </fieldset>
                )}
                <button
                  className="go next"
                  type="button"
                  onClick={continueToWorkAreas}
                >
                  Next
                </button>
              </div>
            )}

            {joinStep === "work" && (
              <div className="work-fields">
                <button
                  className="step-back"
                  type="button"
                  onClick={() => setJoinStep("experience")}
                  disabled={busy}
                >
                  ← Back
                </button>
                <p className="form-kicker">Professional application</p>
                <h2>Where would you like to work?</h2>
                <p className="section-intro">
                  Choose every London area you cover and how far you are
                  normally willing to travel.
                </p>

                <label>What do you offer?</label>
                <div className="checks">
                  {skills.map((service) => (
                    <span className="chk on" key={service}>
                      {service === "cleaning" ? "Home cleaning" : "Handyman"}
                    </span>
                  ))}
                </div>

                {handymanSelected && (
                  <label>
                    Postcodes or outward codes covered
                    <input
                      value={coveragePostcodes}
                      onChange={(event) =>
                        setCoveragePostcodes(event.target.value.toUpperCase())
                      }
                      placeholder="SW1A, W8, NW1"
                    />
                  </label>
                )}
                <label>
                  Home postcode (private, optional)
                  <input
                    autoComplete="postal-code"
                    value={homePostcode}
                    onChange={(event) =>
                      setHomePostcode(event.target.value.toUpperCase())
                    }
                    placeholder="SW1A 1AA"
                  />
                </label>
                <label>Areas of London covered</label>
                <div className="checks">
                  {areas.length === 0 ? (
                    <span className="muted">Loading areas…</span>
                  ) : (
                    areas.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={areaIds.includes(a.id) ? "chk on" : "chk"}
                        onClick={() => setAreaIds((l) => toggle(l, a.id))}
                        title={(a.postcode_prefixes ?? []).join(", ")}
                      >
                        {a.name}
                      </button>
                    ))
                  )}
                </div>

                <label htmlFor="provider-travel-distance">
                  Maximum travel distance
                </label>
                <select
                  id="provider-travel-distance"
                  value={maxTravelDistance}
                  onChange={(event) => setMaxTravelDistance(event.target.value)}
                >
                  <option value="" disabled>
                    Select a distance
                  </option>
                  {PROVIDER_TRAVEL_DISTANCES.map((distance) => (
                    <option key={distance} value={distance}>
                      {distance}
                    </option>
                  ))}
                </select>

                <button
                  className="go next"
                  type="button"
                  onClick={continueToAvailability}
                >
                  Next
                </button>
              </div>
            )}

            {joinStep === "availability" && (
              <div className="availability-fields">
                <button
                  className="step-back"
                  type="button"
                  onClick={() => setJoinStep("work")}
                  disabled={busy}
                >
                  ← Back
                </button>
                <p className="form-kicker">Professional application</p>
                <h2>When are you available?</h2>
                <p className="section-intro">
                  Choose one period for every day. Select Off when you do not
                  want jobs that day.
                </p>

                <div className="availability-table">
                  <div className="availability-grid-header" aria-hidden="true">
                    <span>Day</span>
                    {PROVIDER_AVAILABILITY_PERIODS.map((period) => (
                      <span key={period}>{AVAILABILITY_LABELS[period]}</span>
                    ))}
                  </div>
                  {PROVIDER_WEEKDAYS.map(({ key, label }) => (
                    <fieldset className="availability-row" key={key}>
                      <legend>{label}</legend>
                      {PROVIDER_AVAILABILITY_PERIODS.map((period) => (
                        <label
                          key={period}
                          title={`${label}: ${AVAILABILITY_LABELS[period]}`}
                        >
                          <input
                            type="radio"
                            name={`availability-${key}`}
                            checked={weeklyAvailability[key] === period}
                            onChange={() =>
                              setWeeklyAvailability((current) => ({
                                ...current,
                                [key]: period,
                              }))
                            }
                          />
                          <span aria-hidden="true" />
                          <b>{AVAILABILITY_LABELS[period]}</b>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>

                <label htmlFor="provider-weekly-hours">
                  How many cleaning hours would you ideally like each week?
                </label>
                <input
                  id="provider-weekly-hours"
                  type="number"
                  min="0"
                  max={PROVIDER_MAX_WEEKLY_HOURS}
                  step="1"
                  value={weeklyHours}
                  onChange={(event) =>
                    setWeeklyHours(Number(event.target.value))
                  }
                />
                {!hasWorkingPeriod && (
                  <p className="help-copy">
                    Choose at least one working period before submitting.
                  </p>
                )}

                <button
                  className="go next"
                  type="button"
                  onClick={continueToDbs}
                >
                  Continue to DBS check
                </button>
              </div>
            )}

            {joinStep === "dbs" && (
              <div className="dbs-fields">
                <button
                  className="step-back"
                  type="button"
                  onClick={() => setJoinStep("availability")}
                  disabled={busy || Boolean(createdApplication)}
                >
                  ← Back
                </button>
                <p className="form-kicker">Final application step</p>
                <h2>DBS certificate</h2>
                <p className="section-intro">
                  Submit your DBS certificate for private administrator review.
                  You cannot be approved until it has been verified.
                </p>

                <div className="dbs-privacy-note">
                  Your certificate is stored privately. Customers cannot view
                  the document or certificate number.
                </div>

                <label htmlFor="provider-dbs-number">Certificate number</label>
                <input
                  id="provider-dbs-number"
                  value={dbsCertificateNumber}
                  onChange={(event) =>
                    setDbsCertificateNumber(
                      normalizeDbsCertificateNumber(event.target.value),
                    )
                  }
                  placeholder="12-digit DBS certificate number"
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={Boolean(createdApplication)}
                />
                {dbsCertificateNumber.length > 0 &&
                  !isDbsCertificateNumber(dbsCertificateNumber) && (
                    <p className="field-error">
                      Enter all 12 digits shown on the certificate.
                    </p>
                  )}

                <label htmlFor="provider-dbs-date">
                  Certificate issue date
                </label>
                <input
                  id="provider-dbs-date"
                  type="date"
                  value={dbsIssueDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setDbsIssueDate(event.target.value)}
                  disabled={Boolean(createdApplication)}
                />

                <label htmlFor="provider-dbs-file">Certificate file</label>
                <input
                  id="provider-dbs-file"
                  className="dbs-file"
                  type="file"
                  accept={DBS_CERTIFICATE_ACCEPT}
                  onChange={(event) =>
                    setDbsCertificate(event.target.files?.[0] ?? null)
                  }
                />
                <p className="help-copy">
                  PDF, JPG or PNG · maximum{" "}
                  {DBS_CERTIFICATE_MAX_BYTES / 1024 / 1024} MB.
                  {dbsCertificate ? ` Selected: ${dbsCertificate.name}` : ""}
                </p>

                <label className="legal-consent">
                  <input
                    type="checkbox"
                    checked={professionalAgreementAccepted}
                    onChange={(event) =>
                      setProfessionalAgreementAccepted(event.target.checked)
                    }
                  />
                  <span>
                    I have read and accept the{" "}
                    <a
                      href={PROFESSIONAL_PARTNER_AGREEMENT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Service Professional Partner Agreement
                    </a>{" "}
                    and acknowledge the{" "}
                    <a
                      href={PRIVACY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>

                <div className="form-actions">
                  <button
                    className="go"
                    type="button"
                    onClick={submit}
                    disabled={busy || !ready}
                  >
                    {busy ? step || "Working…" : "Create professional account"}
                  </button>
                </div>
                <p className="small">
                  Your application remains pending until an administrator
                  verifies the DBS certificate and approves your account.
                </p>
              </div>
            )}

            {err && <p className="err">{err}</p>}
          </div>
        </section>

        <section className="benefits" aria-label="Why work with Opulence Bliss">
          <article className="perks">
            <h2>Your earnings could be</h2>
            <ul>
              <li>
                <strong>£18–£22/hr</strong> before taxes
              </li>
              <li>
                Up to <strong>£2,160/month</strong> for 30 hours per week
              </li>
              <li>
                We connect you to <strong>new customers</strong> easily without
                having to search for them
              </li>
            </ul>
          </article>

          <article className="perks">
            <h2>Your freedom, your peace</h2>
            <ul>
              <li>
                Work <strong>when and where you want</strong>
              </li>
              <li>
                <strong>Free</strong> and non-exclusive
              </li>
              <li>
                <strong>Self-employed</strong> but fully supported
              </li>
            </ul>
          </article>

          <article className="perks">
            <h2>Protect yourself</h2>
            <ul>
              <li>Bookings &amp; customer acquisition</li>
              <li>Priority access to jobs</li>
              <li>
                Easy payment processing: <strong>weekly or monthly</strong>
              </li>
              <li>
                <strong>Administrative support</strong>
              </li>
              <li>Referral income &amp; loyalty/ambassador rewards</li>
            </ul>
          </article>

          {reviews.length > 0 && (
            <article className="perks reviews-block">
              <h2>What customers say about our professionals</h2>
              <ul className="review-list">
                {reviews.map((review) => (
                  <li key={review.id}>
                    <span
                      className="review-score"
                      aria-label={`${review.rating} out of 5 stars`}
                    >
                      <span aria-hidden="true">
                        {"★".repeat(review.rating)}
                        {"☆".repeat(5 - review.rating)}
                      </span>
                      <span className="sr-only">
                        {review.rating} out of 5 stars
                      </span>
                    </span>
                    {review.comment?.trim() && <p>{review.comment}</p>}
                    <cite>{review.recipient_name}</cite>
                  </li>
                ))}
              </ul>
              <a className="review-link" href="/reviews">
                Read all reviews
              </a>
            </article>
          )}
        </section>

        <section className="next-steps" aria-label="How joining works">
          <ol className="steps">
            <li>
              <span>1</span> Create your professional account
            </li>
            <li>
              <span>2</span> Complete approval and set your hours
            </li>
            <li>
              <span>3</span> Accept jobs and choose weekly, fortnightly or
              monthly payouts
            </li>
          </ol>

          <p className="already">
            Already a provider? <a href="/provider/login">Log in</a>
          </p>
        </section>
      </div>

      <style jsx>{`
        .wrap {
          min-height: 100vh;
          min-height: 100dvh;
          overflow-x: clip;
          background:
            radial-gradient(
              900px 520px at 8% -6%,
              rgba(245, 197, 66, 0.26),
              transparent 62%
            ),
            radial-gradient(
              820px 560px at 96% 2%,
              rgba(200, 111, 201, 0.24),
              transparent 60%
            ),
            linear-gradient(
              180deg,
              #f7f2ff 0%,
              #fbf8ff 38%,
              #ffffff 72%,
              #ffffff 100%
            );
          background-repeat: no-repeat;
          color: #16202a;
          font-family: "Nunito", system-ui, sans-serif;
          padding: 0 20px 70px;
        }
        .grid {
          max-width: 960px;
          margin: 0 auto;
          padding-top: 28px;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 30px;
          align-items: start;
        }
        /* Grid items default to min-width:auto, which lets a wide child
           stretch the track and push the whole page sideways. */
        .pitch,
        .form,
        .benefits,
        .next-steps {
          min-width: 0;
        }
        .pitch {
          max-width: 820px;
        }
        h1 {
          font-family: "Nunito", system-ui, sans-serif;
          font-weight: 900;
          font-size: clamp(32px, 4.6vw, 46px);
          line-height: 1.06;
          color: #16202a;
          margin: 0;
        }
        h2 {
          font-family: "Nunito", system-ui, sans-serif;
          font-weight: 900;
          font-size: 24px;
          color: #16202a;
          margin: 0 0 20px;
        }
        .benefits {
          display: grid;
          gap: 14px;
          margin-top: 8px;
        }
        .perks {
          padding: clamp(18px, 3vw, 24px);
          border: 0;
          border-radius: 18px;
          background: #f7f6f9;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
        }
        .perks h2 {
          margin: 0 0 13px;
          color: #16202a;
          font-size: clamp(20px, 3vw, 25px);
          font-weight: 900;
          line-height: 1.1;
        }
        .perks ul {
          display: grid;
          gap: 7px;
          margin: 0;
          padding-left: 21px;
          list-style: disc;
        }
        .perks li {
          padding-left: 2px;
          color: #25282d;
          font-size: clamp(14px, 2vw, 16px);
          line-height: 1.42;
          overflow-wrap: anywhere;
        }
        .perks strong {
          color: #16202a;
          font-weight: 900;
        }
        /* Keep review cards independent from the bullet styling used by the
           benefit lists above. */
        .perks .review-list {
          padding: 0;
          list-style: none;
        }
        .perks .review-list > li {
          padding-left: 0;
        }
        .review-list > li {
          padding: 0 0 18px;
          border-bottom: 1px solid #e5e0ec;
        }
        .review-list > li:last-child {
          padding-bottom: 0;
          border-bottom: 0;
        }
        .review-score {
          display: inline-flex;
          color: #6d28d9;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 2px;
          line-height: 1;
        }
        .review-list p {
          margin: 8px 0 5px;
          color: #3f4652;
          font-size: 16px;
          line-height: 1.5;
        }
        .review-list cite {
          display: block;
          margin-top: 3px;
          color: #7a828c;
          font-size: 13px;
          font-style: normal;
          font-weight: 800;
        }
        .review-link {
          display: inline-block;
          margin-top: 22px;
          color: #6d28d9;
          font-weight: 900;
          text-decoration: none;
        }
        .review-link:hover {
          text-decoration: underline;
        }
        .next-steps {
          width: 100%;
          max-width: 760px;
          justify-self: center;
          padding: 8px 4px 0;
        }
        .steps {
          list-style: none;
          padding: 0;
          margin: 0 0 22px;
          display: grid;
          gap: 12px;
        }
        .steps li {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 15px;
          color: #16202a;
        }
        .steps span {
          display: grid;
          place-items: center;
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          border-radius: 50%;
          background: #f4ecfe;
          color: #16202a;
          font-family: "Nunito", system-ui, sans-serif;
          font-size: 14px;
        }
        .already {
          font-size: 14.5px;
          color: #7a828c;
        }
        .already a {
          color: #16202a;
          font-weight: 600;
        }
        .form {
          position: relative;
          width: 100%;
          max-width: 760px;
          box-sizing: border-box;
          justify-self: center;
          min-width: 0;
          overflow: hidden;
          border: 1px solid rgba(109, 40, 217, 0.18);
          border-radius: 28px;
          padding: 14px;
          box-shadow: 0 24px 64px rgba(76, 29, 149, 0.15);
          transition:
            background 0.3s ease,
            box-shadow 0.3s ease;
        }
        .form::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(
              circle at 92% 4%,
              rgba(200, 111, 201, 0.3),
              transparent 34%
            ),
            radial-gradient(
              circle at 5% 96%,
              rgba(245, 197, 66, 0.26),
              transparent 38%
            );
        }
        .estimate-mode {
          background: linear-gradient(
            145deg,
            #fff8df 0%,
            #f8efff 48%,
            #e9e1ff 100%
          );
        }
        .application-mode {
          background: linear-gradient(
            155deg,
            #ddd9ff 0%,
            #eee8ff 48%,
            #fff5df 100%
          );
        }
        .form-surface {
          position: relative;
          z-index: 1;
          min-width: 0;
          border-radius: 19px;
        }
        .estimate-mode .form-surface {
          padding: 24px 20px;
          background: rgba(255, 255, 255, 0.2);
        }
        .application-mode .form-surface {
          padding: 28px;
          border: 1px solid rgba(255, 255, 255, 0.86);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 12px 34px rgba(76, 29, 149, 0.1);
        }
        .form-kicker {
          margin: 0 0 7px;
          color: #6d28d9;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .step-back {
          width: max-content;
          margin: 0 0 24px;
          padding: 0;
          border: 0;
          background: transparent;
          color: #6d28d9;
          font: inherit;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }
        .availability-card {
          padding: 22px;
          border: 1px solid rgba(109, 40, 217, 0.18);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.64);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(8px);
        }
        .availability-heading {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 6px 16px;
          align-items: center;
          margin-bottom: 15px;
          color: #16202a;
          font-size: 15px;
        }
        .availability-heading strong {
          white-space: nowrap;
          font-weight: 900;
        }
        input.hours-slider {
          width: 100%;
          min-height: 0;
          height: 22px;
          margin: 0;
          padding: 0;
          border: 0;
          border-radius: 999px;
          background: transparent;
          box-shadow: none;
          accent-color: #7b2ff7;
          cursor: pointer;
        }
        input.hours-slider:focus-visible {
          box-shadow: none;
          outline: 3px solid rgba(109, 40, 217, 0.2);
          outline-offset: 5px;
        }
        .range-labels {
          display: flex;
          justify-content: space-between;
          margin-top: 1px;
          color: #7a828c;
          font-size: 11px;
          font-weight: 800;
        }
        .simulation {
          margin-top: 18px;
          padding: 18px;
          border: 1.5px solid #16202a;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.9);
        }
        .simulation > p {
          margin: 0 0 14px;
          color: #6d28d9;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .simulation > div {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }
        .simulation span {
          display: grid;
          min-width: 0;
          gap: 3px;
          color: #535d69;
          font-size: 12px;
        }
        .simulation strong {
          color: #16202a;
          font-size: clamp(19px, 5.4vw, 24px);
          font-weight: 900;
          line-height: 1.05;
          overflow-wrap: anywhere;
        }
        .estimate-note {
          margin: 12px 0 0;
          color: #7a828c;
          font-size: 11px;
          text-align: center;
        }
        .signup-button {
          min-height: 54px;
          margin-top: 18px;
          box-shadow: 0 11px 28px rgba(109, 40, 217, 0.2);
        }
        .meet-heading {
          margin-bottom: 7px;
          font-size: clamp(30px, 4.5vw, 39px);
          letter-spacing: -0.025em;
        }
        label {
          display: block;
          font-size: 13.5px;
          color: #7a828c;
          margin: 0 0 6px;
        }
        input {
          width: 100%;
          box-sizing: border-box;
          min-height: 44px;
          padding: 9px 13px;
          border: 1.5px solid #d9dde3;
          border-radius: 13px;
          font: inherit;
          font-size: 15.5px;
          background: #fff;
          color: #16202a;
          margin-bottom: 7px;
        }
        .application-mode
          input:not([type="radio"]):not([type="checkbox"]):not(.hours-slider),
        .application-mode select {
          min-height: 44px;
          border-radius: 13px;
          font-size: 16px;
        }
        input:focus-visible {
          outline: none;
          border-color: #6d28d9;
          box-shadow: 0 0 0 3px rgba(109, 40, 217, 0.09);
        }
        select {
          width: 100%;
          min-height: 44px;
          box-sizing: border-box;
          margin: 0 0 8px;
          padding: 9px 38px 9px 13px;
          border: 1.5px solid #d9dde3;
          border-radius: 13px;
          background: #fff;
          color: #16202a;
          font: inherit;
          font-size: 15px;
        }
        select:focus-visible {
          border-color: #6d28d9;
          outline: none;
          box-shadow: 0 0 0 3px rgba(109, 40, 217, 0.09);
        }
        input.invalid,
        input.invalid:focus-visible {
          border-color: #e5394f;
          box-shadow: 0 0 0 3px rgba(229, 57, 79, 0.08);
        }
        .account-fields,
        .status-fields,
        .experience-fields,
        .availability-fields,
        .dbs-fields,
        .work-fields {
          display: grid;
        }
        .dbs-privacy-note {
          margin: 0 0 18px;
          padding: 13px 14px;
          border: 1px solid #d7e8de;
          border-radius: 13px;
          background: #f1fbf4;
          color: #276343;
          font-size: 12.5px;
          font-weight: 800;
          line-height: 1.5;
        }
        .dbs-file {
          height: auto;
          padding: 9px;
          color: #4b5563;
          font-size: 13px;
        }
        .dbs-file::file-selector-button {
          margin-right: 10px;
          padding: 7px 12px;
          border: 0;
          border-radius: 999px;
          background: #f4ecfe;
          color: #6d28d9;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
        }
        .help-copy {
          margin: -8px 2px 20px;
          color: #7a828c;
          font-size: 12px;
        }
        .legal-consent {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 2px 0 17px;
          padding: 14px;
          border: 1px solid #e2d5f8;
          border-radius: 13px;
          background: #faf7ff;
          color: #4b5563;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.5;
        }
        .legal-consent input {
          width: 18px;
          height: 18px;
          min-height: 0;
          flex: 0 0 auto;
          margin: 1px 0 0;
          padding: 0;
          accent-color: #6d28d9;
        }
        .legal-consent a {
          color: #6d28d9;
          font-weight: 900;
          text-underline-offset: 2px;
        }
        .status-fields label > span {
          color: #8c95a0;
          font-weight: 600;
        }
        .choice-card,
        .multi-card {
          margin: 0 0 18px;
          padding: 17px;
          border: 1px solid #e2d5f8;
          border-radius: 15px;
          background: #faf7ff;
        }
        .choice-card legend,
        .multi-card legend {
          padding: 0 4px;
          color: #16202a;
          font-size: 13.5px;
          font-weight: 900;
        }
        .choice-options {
          position: relative;
          display: flex;
          flex-wrap: wrap;
          gap: 11px 20px;
          margin-top: 8px;
        }
        .choice-options label {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          margin: 0;
          color: #16202a;
          font-weight: 800;
          cursor: pointer;
        }
        .choice-options input {
          position: absolute;
          width: 1px;
          height: 1px;
          min-height: 0;
          margin: 0;
          opacity: 0;
        }
        .choice-options label > span {
          width: 22px;
          height: 22px;
          box-sizing: border-box;
          border: 1.5px solid #8e96a1;
          border-radius: 50%;
          background: #fff;
          box-shadow: inset 0 0 0 5px #fff;
        }
        .choice-options input:checked + span {
          border-color: #6d28d9;
          background: #6d28d9;
        }
        .choice-options input:focus-visible + span {
          outline: 3px solid rgba(109, 40, 217, 0.18);
          outline-offset: 2px;
        }
        .multi-card > p {
          margin: 4px 0 13px;
          color: #68717d;
          font-size: 12px;
        }
        .multi-options {
          position: relative;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }
        .multi-options label {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          margin: 0;
          padding: 10px;
          border: 1px solid #e5e0ec;
          border-radius: 10px;
          background: #fff;
          color: #343d48;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }
        .multi-options input {
          position: absolute;
          width: 1px;
          height: 1px;
          min-height: 0;
          margin: 0;
          opacity: 0;
        }
        .multi-options label > span {
          display: grid;
          flex: 0 0 auto;
          width: 19px;
          height: 19px;
          place-items: center;
          border: 1.5px solid #8e96a1;
          border-radius: 6px;
          color: transparent;
          font-size: 12px;
        }
        .multi-options input:checked + span {
          border-color: #6d28d9;
          background: #6d28d9;
          color: #fff;
        }
        .multi-options input:focus-visible + span {
          outline: 3px solid rgba(109, 40, 217, 0.18);
          outline-offset: 2px;
        }
        .availability-table {
          display: grid;
          gap: 5px;
          margin-bottom: 20px;
          padding: 10px;
          overflow-x: auto;
          border: 1px solid #e2d5f8;
          border-radius: 15px;
          background: #faf7ff;
        }
        .availability-grid-header,
        .availability-row {
          display: grid;
          grid-template-columns: minmax(74px, 1.25fr) repeat(
              5,
              minmax(44px, 1fr)
            );
          gap: 5px;
          min-width: 405px;
          align-items: center;
        }
        .availability-grid-header {
          padding: 0 3px 5px;
          color: #7a828c;
          font-size: 9px;
          font-weight: 900;
          text-align: center;
        }
        .availability-grid-header span:first-child {
          text-align: left;
        }
        .availability-row {
          margin: 0;
          padding: 0;
          border: 0;
        }
        .availability-row legend {
          float: left;
          width: auto;
          padding: 0 4px;
          color: #16202a;
          font-size: 11px;
          font-weight: 900;
        }
        .availability-row label {
          position: relative;
          display: grid;
          min-height: 36px;
          place-items: center;
          margin: 0;
          border: 1px solid #e5e0ec;
          border-radius: 8px;
          background: #fff;
          cursor: pointer;
        }
        .availability-row input {
          position: absolute;
          width: 1px;
          height: 1px;
          min-height: 0;
          margin: 0;
          opacity: 0;
        }
        .availability-row label > span {
          width: 16px;
          height: 16px;
          box-sizing: border-box;
          border: 1.5px solid #9aa1aa;
          border-radius: 50%;
          background: #fff;
          box-shadow: inset 0 0 0 4px #fff;
        }
        .availability-row label > b {
          display: none;
        }
        .availability-row input:checked + span {
          border-color: #6d28d9;
          background: #6d28d9;
        }
        .availability-row label:has(input:checked) {
          border-color: #b797ee;
          background: #f4ecfe;
        }
        .availability-row input:focus-visible + span {
          outline: 3px solid rgba(109, 40, 217, 0.18);
          outline-offset: 2px;
        }
        .employment-card {
          margin: 2px 0 18px;
          padding: 19px;
          border: 1px solid #e2d5f8;
          border-radius: 15px;
          background: #faf7ff;
        }
        .employment-card > p {
          margin: 0 0 16px;
          color: #68717d;
          font-size: 13.5px;
          line-height: 1.5;
        }
        .employment-options {
          position: relative;
          display: grid;
          gap: 12px;
          margin: 0;
          padding: 0;
          border: 0;
        }
        .employment-options legend {
          margin-bottom: 12px;
          color: #16202a;
          font-size: 13.5px;
          font-weight: 900;
        }
        .employment-options label {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: #16202a;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }
        .employment-options input {
          position: absolute;
          width: 1px;
          height: 1px;
          min-height: 0;
          margin: 0;
          opacity: 0;
        }
        .employment-options label > span {
          width: 22px;
          height: 22px;
          box-sizing: border-box;
          border: 1.5px solid #8e96a1;
          border-radius: 50%;
          background: #fff;
          box-shadow: inset 0 0 0 5px #fff;
        }
        .employment-options input:checked + span {
          border-color: #6d28d9;
          background: #6d28d9;
        }
        .employment-options input:focus-visible + span {
          outline: 3px solid rgba(109, 40, 217, 0.18);
          outline-offset: 2px;
        }
        .unable-panel {
          display: grid;
          min-height: 440px;
          align-content: center;
          padding: 4px;
        }
        .unable-heading {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          margin-bottom: 20px;
        }
        .unable-heading > span {
          order: 2;
          font-size: 36px;
        }
        .unable-heading h2 {
          margin-bottom: 8px;
          font-size: clamp(29px, 4vw, 38px);
          line-height: 1.02;
        }
        .unable-copy {
          padding: 20px;
          border: 1px solid #ddd1f5;
          border-radius: 16px;
          background: linear-gradient(145deg, #fff8e7, #f4ecfe);
        }
        .unable-copy p {
          margin: 0 0 14px;
          color: #343d48;
          font-size: 14px;
          line-height: 1.55;
        }
        .unable-copy p:last-child {
          margin-bottom: 0;
        }
        .title-options {
          position: relative;
          display: flex;
          flex-wrap: wrap;
          gap: 12px 28px;
          margin: 0 0 16px;
          padding: 0;
          border: 0;
        }
        .title-option {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          margin: 0;
          color: #16202a;
          font-size: 15px;
          font-weight: 800;
          cursor: pointer;
        }
        .title-option input {
          position: absolute;
          width: 1px;
          height: 1px;
          min-height: 0;
          margin: 0;
          opacity: 0;
        }
        .title-option span {
          width: 22px;
          height: 22px;
          box-sizing: border-box;
          border: 1.5px solid #8e96a1;
          border-radius: 50%;
          background: #fff;
          box-shadow: inset 0 0 0 5px #fff;
        }
        .title-option input:checked + span {
          border-color: #6d28d9;
          background: #6d28d9;
        }
        .title-option input:focus-visible + span {
          outline: 3px solid rgba(109, 40, 217, 0.18);
          outline-offset: 2px;
        }
        .password-field,
        .phone-field {
          position: relative;
        }
        .password-field input {
          padding-right: 54px;
        }
        .password-field button {
          position: absolute;
          top: 9px;
          right: 9px;
          display: grid;
          width: 38px;
          height: 38px;
          place-items: center;
          border: 0;
          background: transparent;
          color: #16202a;
          cursor: pointer;
        }
        .password-requirements {
          margin: -2px 0 10px;
          padding: 8px 10px;
          border: 1px solid #e7e0f2;
          border-radius: 13px;
          background: #faf8fd;
        }
        .password-requirements > p {
          margin: 0 0 6px;
          color: #7a828c;
          font-size: 11px;
          font-weight: 800;
        }
        .password-requirements ul {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 4px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .password-requirements li {
          display: grid;
          min-width: 0;
          justify-items: center;
          gap: 2px;
          color: #9aa1aa;
          text-align: center;
        }
        .password-requirements b {
          color: #68717d;
          font-size: 13px;
          line-height: 1;
        }
        .password-requirements span {
          font-size: 8.5px;
          font-weight: 900;
          overflow-wrap: anywhere;
        }
        .password-requirements li.passed,
        .password-requirements li.passed b {
          color: #137b4e;
        }
        .password-requirements li.missing,
        .password-requirements li.missing b {
          color: #c0392f;
        }
        .password-field.invalid input {
          border-color: #e5394f;
          box-shadow: 0 0 0 3px rgba(229, 57, 79, 0.08);
        }
        .phone-field {
          display: grid;
          grid-template-columns: auto auto minmax(0, 1fr);
          align-items: center;
          min-height: 44px;
          margin-bottom: 7px;
          padding-left: 13px;
          border: 1.5px solid #d9dde3;
          border-radius: 13px;
          background: #fff;
        }
        .phone-field:focus-within {
          border-color: #6d28d9;
          box-shadow: 0 0 0 3px rgba(109, 40, 217, 0.09);
        }
        .phone-field.invalid,
        .phone-field.invalid:focus-within {
          border-color: #e5394f;
          box-shadow: 0 0 0 3px rgba(229, 57, 79, 0.08);
        }
        .phone-code {
          margin: 0 7px;
          color: #5f6874;
          font-size: 14px;
          font-weight: 800;
        }
        .uk-flag {
          display: block;
          width: 24px;
          height: 16px;
          overflow: hidden;
          border-radius: 2px;
          box-shadow: 0 0 0 1px rgba(22, 32, 42, 0.15);
        }
        .phone-field input {
          min-height: 41px;
          margin: 0;
          padding-left: 4px;
          border: 0;
          box-shadow: none;
        }
        .phone-field input:focus-visible {
          box-shadow: none;
        }
        .field-error {
          margin: -4px 2px 8px;
          color: #d82f45;
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.3;
        }
        .dob-label {
          margin: 2px 0 4px;
          color: #16202a;
          font-size: 12.5px;
          font-weight: 800;
        }
        input[type="date"] {
          /* iOS Safari gives date inputs an intrinsic width that ignores
             width:100%, which pushes them past the card edge. */
          -webkit-appearance: none;
          appearance: none;
          min-width: 0;
          max-width: 100%;
          color: #7a828c;
        }
        @media (hover: hover) and (pointer: fine) {
          input,
          select,
          .application-mode
            input:not([type="radio"]):not([type="checkbox"]):not(.hours-slider),
          .application-mode select {
            min-height: 40px;
            padding-top: 7px;
            padding-bottom: 7px;
            margin-bottom: 6px;
          }
          .phone-field {
            min-height: 40px;
            margin-bottom: 6px;
          }
          .phone-field input {
            min-height: 37px;
            margin: 0;
          }
          .password-requirements {
            padding: 7px 10px;
            margin-bottom: 8px;
          }
          .field-error {
            font-size: 12px;
          }
        }
        .section-intro {
          margin: -5px 0 22px;
          color: #68717d;
          font-size: 14px;
          line-height: 1.5;
        }
        .checks {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 18px;
        }
        .chk {
          max-width: 100%;
          background: #ffffff;
          border: 1.5px solid #edeff1;
          border-radius: 999px;
          padding: 9px 16px;
          font: inherit;
          font-size: 14px;
          color: #16202a;
          text-align: left;
          overflow-wrap: anywhere;
          cursor: pointer;
        }
        .chk:hover {
          border-color: #6d28d9;
        }
        .chk.on {
          background: #f4ecfe;
          border-color: #16202a;
          color: #16202a;
          font-weight: 600;
        }
        .go {
          width: 100%;
          background: linear-gradient(100deg, #f5c542, #c86fc9 55%, #7b2ff7);
          color: #fff;
          border: none;
          border-radius: 999px;
          padding: 14px;
          font: inherit;
          font-weight: 600;
          font-size: 16px;
          cursor: pointer;
          margin-top: 6px;
        }
        .go:hover:not(:disabled) {
          background: #4c1d95;
        }
        .go.next {
          width: auto;
          min-width: 128px;
          justify-self: center;
          padding-inline: 30px;
        }
        .go:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .small {
          font-size: 12.5px;
          color: #7a828c;
          text-align: center;
          margin: 12px 0 0;
        }
        .form-actions {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: end;
        }
        .back {
          min-height: 50px;
          padding: 0 20px;
          border: 1.5px solid #dccbfa;
          border-radius: 999px;
          background: #faf7ff;
          color: #6d28d9;
          font: inherit;
          font-weight: 800;
          cursor: pointer;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .err {
          background: #ffe6ea;
          color: #b0384f;
          padding: 12px 14px;
          border-radius: 10px;
          font-size: 14px;
          margin: 16px 0 0;
        }
        .muted {
          color: #7a828c;
          font-size: 14px;
        }
        @media (max-width: 880px) {
          .grid {
            gap: 34px;
          }
        }
        @media (max-width: 520px) {
          .wrap {
            padding-inline: 14px;
          }
          .grid {
            padding-top: 20px;
          }
          .form {
            padding: 10px;
          }
          .estimate-mode .form-surface,
          .application-mode .form-surface {
            padding: 22px 17px;
          }
          .perks {
            padding: 26px 22px;
            border-radius: 21px;
          }
          .form-actions {
            grid-template-columns: 1fr;
          }
          /* Drops to a single column on its own once two columns no longer
             fit the currency figures, so there is no magic breakpoint. */
          .simulation > div {
            grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
            gap: 14px;
          }
        }
        @media (max-width: 400px) {
          .form {
            padding: 8px;
            border-radius: 20px;
          }
          .estimate-mode .form-surface,
          .application-mode .form-surface {
            padding: 20px 14px;
          }
          .availability-card {
            padding: 16px;
          }
          .simulation {
            padding: 14px;
          }
          .employment-card {
            padding: 16px;
          }
          .unable-copy {
            padding: 16px;
          }
          .title-options {
            gap: 12px 20px;
          }
        }
      `}</style>
    </main>
  );
}
