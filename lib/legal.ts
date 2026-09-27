export const TERMS_URL = process.env.NEXT_PUBLIC_TERMS_URL || "/legal/terms";
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || "/legal/privacy";
export const CANCELLATION_REFUND_URL =
  process.env.NEXT_PUBLIC_CANCELLATION_REFUND_URL ||
  "/legal/cancellation-refund";
export const PROFESSIONAL_PARTNER_AGREEMENT_URL =
  process.env.NEXT_PUBLIC_PROFESSIONAL_PARTNER_AGREEMENT_URL ||
  "/legal/professional-partner-agreement";

export const LEGAL_VERSIONS: Record<string, string> = {
  terms: "2.0",
  privacy: "1.0",
  "cancellation-refund": "1.0",
  "professional-partner-agreement": "2026-09-20",
};

/**
 * Details a limited company must show on its website (Companies (Trading
 * Disclosures) Regulations 2008 and the Electronic Commerce Regulations 2002).
 * The registered office address is not known yet: set
 * NEXT_PUBLIC_REGISTERED_OFFICE once the client confirms it.
 */
export const COMPANY = {
  name: "Opulence Bliss Ltd",
  number: "15894675",
  registeredIn: "England and Wales",
  registeredOffice: process.env.NEXT_PUBLIC_REGISTERED_OFFICE?.trim() || "",
};
