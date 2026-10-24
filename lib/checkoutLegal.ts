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

export const SAVED_CARD_CONSENT_TEXT =
  "I authorise Opulence Bliss to save my card with Stripe, charge each regular visit when a cleaner accepts it, and charge any add-on changes I confirm. Add-ons can be changed until 24 hours before the visit.";

/** A single wording source for the linked checkbox and its acceptance record. */
export function checkoutLegalConsentParts(documents: CheckoutLegalDocument[]) {
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
