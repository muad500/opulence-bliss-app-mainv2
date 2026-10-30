import documents from "./finalLegalPack.json";

export const FINAL_LEGAL_EFFECTIVE_DATE = "2026-10-01";
export const FINAL_LEGAL_VERSION = "1.0";
export type FinalLegalSlug = keyof typeof documents;
export const finalLegalDocuments = documents;
export const publicFinalLegalDocuments = Object.values(documents).filter(
  (document) => document.audience !== "professionals",
);
export const professionalFinalLegalDocuments = Object.values(documents).filter(
  (document) => document.audience === "professionals",
);
export function finalLegalDocument(slug: string) {
  return Object.prototype.hasOwnProperty.call(documents, slug)
    ? documents[slug as FinalLegalSlug]
    : null;
}
export function isFinalLegalContent(content: string) {
  return content.includes('data-final-pack="2026-10-01"');
}
export function finalLegalHref(slug: string) {
  return finalLegalDocument(slug)?.audience === "professionals" ||
    slug === "cleaner-terms"
    ? `/provider/join/policies/${slug}`
    : `/legal/${slug}`;
}
