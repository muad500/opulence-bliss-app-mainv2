export type AppAudience = "customer" | "worker";
export const APP_AUDIENCE_KEY = "opulence-app-audience";
export function audienceForPath(path: string): AppAudience | null {
  if (path === "/mobile/customer" || path.startsWith("/mobile/customer/"))
    return "customer";
  if (path === "/mobile/worker" || path.startsWith("/mobile/worker/"))
    return "worker";
  return null;
}
export function appEntry(audience: AppAudience, screen?: string) {
  const allowed =
    audience === "customer"
      ? ["book", "bookings", "account", "inbox"]
      : ["jobs", "hours", "earnings", "account", "inbox"];
  return `/mobile/${audience}${screen && allowed.includes(screen) ? `?screen=${screen}` : ""}`;
}
export function appScreen(
  audience: AppAudience,
  screen: string | null,
): string | null {
  const screens =
    audience === "customer"
      ? {
          book: "/book",
          bookings: "/account",
          account: "/mobile/customer/account",
          inbox: "/mobile/customer/inbox",
        }
      : {
          jobs: "/worker/jobs",
          hours: "/worker/availability",
          earnings: "/worker/earnings",
          account: "/mobile/worker/account",
          inbox: "/mobile/worker/inbox",
        };
  return screens[screen as keyof typeof screens] ?? null;
}
export function appPathAllowed(audience: AppAudience, path: string) {
  if (path === "/") return false;
  if (path.startsWith("/admin") || path.startsWith("/staff")) return false;
  if (path.startsWith("/mobile/")) return audienceForPath(path) === audience;
  if (audience === "customer")
    return !(
      /^\/(worker|provider)(\/|$)/.test(path) ||
      /^\/handyman\/(apply|jobs)(\/|$)/.test(path)
    );
  return !/^\/(account|book|subscribe|services)(\/|$)/.test(path);
}
export function appTabs(audience: AppAudience) {
  return audience === "customer"
    ? [
        { label: "Home", href: "/mobile/customer", icon: "home" },
        { label: "Bookings", href: "/account", icon: "calendar" },
        { label: "Inbox", href: "/mobile/customer/inbox", icon: "message" },
        { label: "Account", href: "/mobile/customer/account", icon: "user" },
      ]
    : [
        { label: "Today", href: "/mobile/worker", icon: "home" },
        { label: "Jobs", href: "/worker/jobs", icon: "briefcase" },
        { label: "Inbox", href: "/mobile/worker/inbox", icon: "message" },
        { label: "Account", href: "/mobile/worker/account", icon: "user" },
      ];
}
