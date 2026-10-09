export const PROFESSIONAL_SERVICES = ["cleaning", "handyman"] as const;
export type ProfessionalService = (typeof PROFESSIONAL_SERVICES)[number];
export type ServiceApproval = "pending" | "approved" | "rejected" | "suspended";
export type ServiceApprovals = Partial<
  Record<ProfessionalService, ServiceApproval>
>;

export function isProfessionalService(
  value: unknown,
): value is ProfessionalService {
  return value === "cleaning" || value === "handyman";
}

export function serviceApproved(
  provider:
    | {
        vetting_status?: string | null;
        is_suspended?: boolean | null;
        service_approvals?: ServiceApprovals | null;
      }
    | null
    | undefined,
  service: ProfessionalService,
): boolean {
  return (
    provider?.vetting_status === "approved" &&
    provider.is_suspended === false &&
    provider.service_approvals?.[service] === "approved"
  );
}

export function visibleProfessionalServices(
  services: string[],
  handymanEnabled: boolean,
) {
  return services.filter(
    (service) =>
      service === "cleaning" || (service === "handyman" && handymanEnabled),
  );
}

export function selectedProfessionalServices(
  value: unknown,
  handymanEnabled: boolean,
): ProfessionalService[] | null {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 2 ||
    value.some(
      (service) =>
        !isProfessionalService(service) ||
        (service === "handyman" && !handymanEnabled),
    )
  )
    return null;
  return [...new Set(value)] as ProfessionalService[];
}
