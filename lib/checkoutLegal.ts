import { FINAL_CHECKOUT_COPY } from "./finalCheckoutCopy";
export const CHECKOUT_LEGAL_SLUGS = [
  "terms",
  "cancellation-refund",
  "privacy",
] as const;
export type CheckoutLegalSlug = (typeof CHECKOUT_LEGAL_SLUGS)[number];
export type CheckoutLegalDocument = {
  slug: CheckoutLegalSlug;
  version: string;
  updatedAt: string | null;
  isFallback?: boolean;
};

export const CHECKOUT_LEGAL_TITLES: Record<CheckoutLegalSlug, string> = {
  terms: "Terms & Conditions",
  "cancellation-refund": "Cancellation & Refund Policy",
  privacy: "Privacy Policy",
};

export const SAVED_CARD_CONSENT_TEXT = FINAL_CHECKOUT_COPY.regular;

/** A single wording source for the linked checkbox and its acceptance record. */
export function checkoutLegalConsentParts(documents: CheckoutLegalDocument[]) {
  if (
    documents.find((d) => d.slug === "terms")?.version === "1.0" &&
    documents.find((d) => d.slug === "cancellation-refund")?.version === "1.0"
  )
    return [
      { text: "I have read and accept the " },
      { text: "Customer Terms and Conditions", slug: "terms" as const },
      { text: " (v1.0), the " },
      {
        text: "Cancellations, Payment and Refunds Policy",
        slug: "cancellation-refund" as const,
      },
      { text: " (v1.0) and the " },
      { text: "Privacy Notice", slug: "privacy" as const },
      { text: "." },
    ];
  const parts: Array<{ text: string; slug?: CheckoutLegalSlug }> = [];
  for (const [slug, prefix, suffix] of [
    ["terms", "I accept the ", " and the "],
    ["cancellation-refund", "", ", and I have read the "],
    ["privacy", "", "."],
  ] as const) {
    if (prefix) parts.push({ text: prefix });
    parts.push({ text: CHECKOUT_LEGAL_TITLES[slug], slug });
    parts.push({
      text: ` (Version ${documents.find((d) => d.slug === slug)!.version})${suffix}`,
    });
  }
  return parts;
}

export function checkoutLegalConsentText(documents: CheckoutLegalDocument[]) {
  return checkoutLegalConsentParts(documents)
    .map((part) => part.text)
    .join("");
}
export function validCheckoutLegalDocuments(
  value: unknown,
): value is CheckoutLegalDocument[] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    CHECKOUT_LEGAL_SLUGS.every(
      (slug) =>
        value.filter(
          (d) =>
            d?.slug === slug &&
            typeof d.version === "string" &&
            d.version.trim().length > 0 &&
            d.version.length <= 80 &&
            (d.isFallback === true
              ? d.updatedAt === null
              : typeof d.updatedAt === "string" &&
                Number.isFinite(Date.parse(d.updatedAt))),
        ).length === 1,
    )
  );
}

export function checkoutLegalMatches(
  a: CheckoutLegalDocument[],
  b: CheckoutLegalDocument[],
) {
  return CHECKOUT_LEGAL_SLUGS.every((slug) => {
    const left = a.find((d) => d.slug === slug),
      right = b.find((d) => d.slug === slug);
    return (
      left &&
      right &&
      left.version === right.version &&
      (left.updatedAt === null
        ? right.updatedAt === null
        : Date.parse(left.updatedAt) === Date.parse(right.updatedAt ?? "")) &&
      Boolean(left.isFallback) === Boolean(right.isFallback)
    );
  });
}
