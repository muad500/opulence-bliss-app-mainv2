// Legal links and accepted snapshots must resolve to the same self-hosted pack.
export const TERMS_URL = "/legal/terms";
export const PRIVACY_URL = "/legal/privacy";
export const CANCELLATION_REFUND_URL = "/legal/cancellation-refund";
export const HANDYMAN_TERMS_URL = "/legal/handyman-terms";
export const PROFESSIONAL_PARTNER_AGREEMENT_URL =
  "/legal/professional-partner-agreement";
export const SAFEGUARDING_URL = "/legal/safeguarding";

export const LEGAL_VERSIONS: Record<string, string> = {
  terms: "1.0",
  privacy: "1.0",
  "cancellation-refund": "1.0",
  "handyman-terms": "1.0",
  "professional-partner-agreement": "2026-09-20",
  safeguarding: "1.0",
  "business-terms": "1.0",
  cookies: "1.0",
  complaints: "1.0",
  "partner-programme": "1.0",
  "cleaner-cancellation": "1.0",
  "handyman-professional-terms": "1.0",
  "dbs-data": "1.0",
};

/**
 * Details a limited company must show on its website (Companies (Trading
 * Disclosures) Regulations 2008 and the Electronic Commerce Regulations 2002).
 * The confirmed registered office is the default. An environment setting can
 * override it when the company's registered office changes.
 */
export const COMPANY = {
  name: "Opulence Bliss Ltd",
  number: "15894675",
  icoRegistrationNumber: "ZC264981",
  registeredIn: "England and Wales",
  registeredOffice:
    process.env.NEXT_PUBLIC_REGISTERED_OFFICE?.trim() ||
    "128 City Road, London, EC1V 2NX",
};
