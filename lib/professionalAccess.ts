export type ProfessionalAccess = {
  vetting_status?: string | null;
  is_suspended?: boolean | null;
} | null | undefined;

export function canUseProfessionalTools(provider: ProfessionalAccess): boolean {
  return provider?.vetting_status === "approved" && provider.is_suspended === false;
}

export function professionalStatusLabel(provider: ProfessionalAccess): string {
  if (!provider) return "Not applied";
  if (provider.is_suspended) return "Suspended";
  if (provider.vetting_status === "approved") return "Approved";
  if (provider.vetting_status === "rejected") return "Application not approved";
  if (provider.vetting_status === "pending") return "Application under review";
  return "Application needs attention";
}
