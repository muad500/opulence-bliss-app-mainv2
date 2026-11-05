// Public form validation only. No credentials, document upload or account role
// is created when a candidate submits this application record.
import { normalizeUkPhone, isValidUkPhone } from "./ukPhone";

export type CleanerApplicationInput = {
  fullName: string;
  email: string;
  phone: string;
  postcode: string;
  areas: string[];
  experience: string;
  availability: string;
  rightToWorkType: string;
  referralCode: string | null;
  checksAcknowledged: true;
};

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw Error(`Enter ${label}.`);
  return value.trim();
}

export function parseCleanerApplication(
  value: unknown,
): CleanerApplicationInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Enter your application details.");
  const input = value as Record<string, unknown>;
  if (input.checksAcknowledged !== true)
    throw Error("Read the Privacy Notice and agree to the application checks.");
  // Never accept a password on the no-login application endpoint, even if an
  // old client accidentally submits the previous registration form.
  if (Object.hasOwn(input, "password"))
    throw Error("This application does not create a login.");
  const fullName = text(input.fullName, "your full name", 150);
  const email = text(input.email, "a valid email address", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error("Enter a valid email address.");
  const rawPhone = text(input.phone, "a UK phone number", 40);
  const nationalPhone = rawPhone.replace(/^(?:\+44|0044|0)/, "");
  if (!isValidUkPhone(nationalPhone))
    throw Error("Enter a valid UK phone number.");
  const phone = normalizeUkPhone(nationalPhone);
  const postcode = text(input.postcode, "a UK postcode", 10)
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!/^(GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(postcode))
    throw Error("Enter a valid UK postcode.");
  if (
    !Array.isArray(input.areas) ||
    input.areas.length < 1 ||
    input.areas.length > 20
  )
    throw Error("Choose between one and twenty coverage areas.");
  const areas = [
    ...new Set(input.areas.map((area) => text(area, "a coverage area", 80))),
  ];
  return {
    fullName,
    email,
    phone,
    postcode,
    areas,
    experience: text(input.experience, "your cleaning experience", 2000),
    availability: text(input.availability, "your general availability", 1000),
    rightToWorkType: text(
      input.rightToWorkType,
      "your right-to-work type",
      150,
    ),
    referralCode:
      input.referralCode == null || input.referralCode === ""
        ? null
        : text(input.referralCode, "a referral code", 80),
    checksAcknowledged: true,
  };
}

/** Staging prototype only until the full onboarding flow is verified. Fail
 * closed for Production or an incorrect database, even if someone sets a flag. */
export function cleanerStage2Enabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV !== "preview" || env.CLEANER_STAGE2_ENABLED !== "true")
    return false;
  try {
    return (
      new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname ===
      "comwdjprdedmsnxtvuuk.supabase.co"
    );
  } catch {
    return false;
  }
}
