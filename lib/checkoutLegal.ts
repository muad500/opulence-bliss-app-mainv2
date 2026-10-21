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
