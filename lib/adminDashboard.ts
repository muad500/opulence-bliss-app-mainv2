export const ADMIN_PREVIEW_LIMIT = 5;
export const ADMIN_PAGE_SIZE = 20;
export function adminPageNumber(value?: string) {
  if (!value || !/^[1-9]\d{0,4}$/.test(value)) return 1;
  return Number(value);
}
export function pendingProfessionalFilter(handyman: boolean) {
  return [
    "service_approvals->>cleaning.eq.pending",
    ...(handyman ? ["service_approvals->>handyman.eq.pending"] : []),
  ].join(",");
}
export function professionalStatus(status: string, suspended = false) {
  if (suspended || status === "suspended")
    return { label: "Suspended", tone: "danger" };
  if (status === "approved") return { label: "Approved", tone: "success" };
  if (status === "rejected") return { label: "Rejected", tone: "danger" };
  return { label: "Awaiting review", tone: "warning" };
}
export function adminListHref(
  path: string,
  page: number,
  filters: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, value);
  if (page > 1) params.set("page", String(page));
  return path + (params.size ? "?" + params.toString() : "");
}
