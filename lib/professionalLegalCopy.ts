import { FINAL_PROFESSIONAL_COPY as copy } from "./finalCheckoutCopy";
export type ProfessionalConsentKey =
  | "cleaner_terms"
  | "handyman_terms"
  | "self_employed"
  | "safeguarding"
  | "dbs"
  | "cleaner_insurance"
  | "handyman_insurance"
  | "regulated_work";
export function professionalConsentBoxes(cleaning: boolean, handyman: boolean) {
  const boxes: Array<{ key: ProfessionalConsentKey; text: string }> = [];
  if (cleaning) boxes.push({ key: "cleaner_terms", text: copy.cleanerTerms });
  if (handyman) boxes.push({ key: "handyman_terms", text: copy.handymanTerms });
  boxes.push(
    { key: "self_employed", text: copy.selfEmployed },
    { key: "safeguarding", text: copy.safeguarding },
    { key: "dbs", text: copy.dbs },
  );
  if (cleaning)
    boxes.push({ key: "cleaner_insurance", text: copy.cleanerInsurance });
  if (handyman)
    boxes.push(
      { key: "handyman_insurance", text: copy.handymanInsurance },
      { key: "regulated_work", text: copy.regulatedWork },
    );
  return boxes;
}
export function validProfessionalConsent(
  value: unknown,
  cleaning: boolean,
  handyman: boolean,
) {
  return Boolean(
    value &&
    typeof value === "object" &&
    professionalConsentBoxes(cleaning, handyman).every(
      (box) => (value as Record<string, unknown>)[box.key] === true,
    ),
  );
}
