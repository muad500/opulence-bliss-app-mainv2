export const PROVIDER_DOCUMENT_TYPES = [
  "right_to_work",
  "photo_id",
  "proof_of_address",
  "public_liability_insurance",
  "trade_certificate",
  "gas_safe_registration",
  "electrical_registration",
] as const;

export type ProviderDocumentType = (typeof PROVIDER_DOCUMENT_TYPES)[number];

export const PROVIDER_DOCUMENT_LABELS: Record<ProviderDocumentType, string> = {
  right_to_work: "Right to work",
  photo_id: "Photo ID",
  proof_of_address: "Proof of address",
  public_liability_insurance: "Public liability insurance",
  trade_certificate: "Training or certification",
  gas_safe_registration: "Gas Safe registration",
  electrical_registration: "Electrical registration",
};

export function isProviderDocumentType(
  value: unknown,
): value is ProviderDocumentType {
  return (
    typeof value === "string" &&
    PROVIDER_DOCUMENT_TYPES.includes(value as ProviderDocumentType)
  );
}

export function validDocumentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function isTradeRegistration(type: string): boolean {
  return type === "gas_safe_registration" || type === "electrical_registration";
}

export function isPropertyMaintenanceDocument(type: string): boolean {
  return type === "trade_certificate" || isTradeRegistration(type);
}

export function documentNeedsExpiry(type: string): boolean {
  return type === "public_liability_insurance" || isTradeRegistration(type);
}
