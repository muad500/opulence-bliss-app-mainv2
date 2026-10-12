export const PORTAL_DATA_UPDATED = "opulence:portal-updated";
export const PORTAL_REFRESH_REQUESTED = "opulence:refresh";

export function portalRefreshInterval(path: string) {
  return path === "/mobile/customer" ||
    path === "/mobile/worker" ||
    path === "/account" ||
    path === "/worker" ||
    path.startsWith("/account/visit/") ||
    path.startsWith("/worker/job/") ||
    path.startsWith("/worker/jobs") ||
    path === "/worker/current"
    ? 10_000
    : 30_000;
}

export function requestPortalRefresh() {
  window.dispatchEvent(new Event(PORTAL_REFRESH_REQUESTED));
}
