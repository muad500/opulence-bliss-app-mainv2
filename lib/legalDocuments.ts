import sanitizeHtml from "sanitize-html";
import { CUSTOMER_TERMS_HTML } from "@/lib/customerTerms";
import {
  CANCELLATION_REFUND_POLICY_HTML,
  HANDYMAN_TERMS_HTML,
  PRIVACY_POLICY_HTML,
  REVIEW_POLICY_HTML,
} from "@/lib/policyContent";

export const LEGAL_DOCUMENT_SLUGS = [
  "terms",
  "privacy",
  "cancellation-refund",
  "handyman-terms",
  "review-policy",
  "professional-partner-agreement",
] as const;

export type LegalDocumentSlug = (typeof LEGAL_DOCUMENT_SLUGS)[number];

export type LegalDocument = {
  slug: LegalDocumentSlug;
  title: string;
  audience: "customers" | "professionals" | "everyone";
  contentHtml: string;
  version: string;
  updatedAt: string | null;
  isFallback?: boolean;
};

const DEFAULTS: Record<LegalDocumentSlug, Omit<LegalDocument, "slug">> = {
  terms: {
    title: "Customer Terms & Conditions",
    audience: "customers",
    version: "2.0",
    updatedAt: null,
    contentHtml: CUSTOMER_TERMS_HTML,
  },
  privacy: {
    title: "Privacy Policy",
    audience: "everyone",
    version: "1.1",
    updatedAt: "2026-09-28T00:00:00.000Z",
    contentHtml: PRIVACY_POLICY_HTML,
  },
  "handyman-terms": {
    title: "Handyman Services Terms",
    audience: "customers",
    version: "1.0",
    updatedAt: "2026-09-27T00:00:00.000Z",
    contentHtml: HANDYMAN_TERMS_HTML,
  },
  "cancellation-refund": {
    title: "Cancellation & Refund Policy",
    audience: "customers",
    version: "1.1",
    updatedAt: "2026-09-28T00:00:00.000Z",
    contentHtml: CANCELLATION_REFUND_POLICY_HTML,
  },
  "review-policy": {
    title: "Review Policy",
    audience: "everyone",
    version: "1.0",
    updatedAt: "2026-09-28T00:00:00.000Z",
    contentHtml: REVIEW_POLICY_HTML,
  },
  "professional-partner-agreement": {
    title: "Service Professional Partner Agreement",
    audience: "professionals",
    version: "2026-09-20",
    updatedAt: null,
    contentHtml: `
      <p><strong>Draft for prototype review.</strong> This agreement must be reviewed and approved by Opulence Bliss and its legal adviser before professionals are onboarded in production.</p>
      <h2>1. Independent professional relationship</h2>
      <p>You provide services as a self-employed independent professional. Nothing in this agreement creates employment, worker, agency or partnership status. You remain responsible for your tax, registrations and legal obligations.</p>
      <h2>2. Application and approval</h2>
      <p>You must provide accurate application information and keep it current. Access to jobs begins only after approval and may depend on identity, right-to-work, background or other appropriate checks.</p>
      <h2>3. Accepting and delivering jobs</h2>
      <p>You decide which offered jobs to accept. Once accepted, you agree to attend on time, communicate through the platform, follow the agreed service details and treat customers and property professionally.</p>
      <h2>4. Fees and payouts</h2>
      <p>The payout shown before acceptance is the amount payable for that job, subject to valid completion, applicable deductions, refunds, disputes and payment holds. Available payout schedules may include weekly or monthly processing.</p>
      <h2>5. Cancellations, lateness and incidents</h2>
      <p>Use the platform controls promptly if you cannot attend or will be late. Report accidents, damage, unsafe conditions or disputes immediately and preserve relevant evidence.</p>
      <h2>6. Insurance and standards</h2>
      <p>You must maintain any insurance, licences and equipment required for your services. Any platform-arranged cover applies only according to its separate policy and eligibility rules.</p>
      <h2>7. Customer information and conduct</h2>
      <p>Use customer information only to complete the booking. Keep it confidential, do not move bookings off-platform and follow the platform's safety, messaging and conduct rules.</p>
      <h2>8. Suspension and ending the agreement</h2>
      <p>Access may be limited or suspended while safety, fraud, quality or compliance concerns are reviewed. Either party may end the relationship subject to outstanding bookings, payments and legal obligations.</p>
      <h2>9. Agreement and updates</h2>
      <p>Submitting the professional application confirms that you have read and accepted the current published version of this agreement.</p>
    `,
  },
};

export function isLegalDocumentSlug(value: string): value is LegalDocumentSlug {
  return LEGAL_DOCUMENT_SLUGS.includes(value as LegalDocumentSlug);
}

export function defaultLegalDocument(slug: LegalDocumentSlug): LegalDocument {
  return { slug, ...DEFAULTS[slug], isFallback: true };
}

export function sanitizeLegalHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "h2", "h3", "strong", "em", "ul", "ol", "li", "a", "br"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          href: attribs.href ?? "#",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  }).trim();
}
