export type ProfessionalAccess =
  | {
      vetting_status?: string | null;
      is_suspended?: boolean | null;
      service_approvals?: Record<string, string> | null;
    }
  | null
  | undefined;

export function canUseProfessionalTools(provider: ProfessionalAccess): boolean {
  return (
    provider?.vetting_status === "approved" &&
    provider.is_suspended === false &&
    (provider.service_approvals === undefined ||
      Object.values(provider.service_approvals ?? {}).includes("approved"))
  );
}

export function professionalStatusLabel(provider: ProfessionalAccess): string {
  if (!provider) return "Not applied";
  if (provider.is_suspended) return "Suspended";
  if (provider.vetting_status === "approved")
    return canUseProfessionalTools(provider)
      ? "Approved"
      : "Service approval required";
  if (provider.vetting_status === "rejected") return "Application not approved";
  if (provider.vetting_status === "pending") return "Application under review";
  return "Application needs attention";
}
