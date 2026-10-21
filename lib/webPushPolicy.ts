type Environment = Record<string, string | undefined>;

// This PR is staging-only. A production release must deliberately review and
// remove this guard; setting the flag on Production cannot activate delivery.
export function webPushEnabled(env: Environment) {
  return (
    env.WEB_PUSH_ENABLED === "true" &&
    env.VERCEL_ENV !== "production" &&
    env.APP_ENV !== "production" &&
    env.NEXT_PUBLIC_SUPABASE_URL === "https://comwdjprdedmsnxtvuuk.supabase.co"
  );
}

export function validPushSubscription(value: unknown): value is {
  endpoint: string;
  keys: { auth: string; p256dh: string };
} {
  if (!value || typeof value !== "object") return false;
  const v = value as {
    endpoint?: unknown;
    keys?: { auth?: unknown; p256dh?: unknown };
  };
  if (typeof v.endpoint !== "string" || v.endpoint.length > 2048) return false;
  try {
    const url = new URL(v.endpoint);
    // Exact browser push providers, never caller-selected arbitrary HTTPS/IPs.
    // Apple intentionally excluded. No redirects are followed by web-push.
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !(
        url.hostname === "fcm.googleapis.com" ||
        url.hostname === "updates.push.services.mozilla.com" ||
        /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)
      )
    )
      return false;
  } catch {
    return false;
  }
  return (
    typeof v.keys?.auth === "string" &&
    /^[A-Za-z0-9_-]{22}$/.test(v.keys.auth) &&
    typeof v.keys?.p256dh === "string" &&
    /^B[A-Za-z0-9_-]{86}$/.test(v.keys.p256dh)
  );
}

export function pushHref(href: unknown) {
  if (
    typeof href !== "string" ||
    !/^\/(account|worker|handyman)(\/|$)/.test(href) ||
    /[\\\s?#]/.test(href)
  )
    return "/notifications";
  return href;
}

export const pushCopy: Record<string, [string, string]> = {
  remaining: [
    "30 minutes remaining",
    "Your session has around 30 minutes remaining. Open your booking for details.",
  ],
  offer: [
    "New job offer",
    "A job in your area is available. Open Opulence Bliss to view it.",
  ],
  taken: [
    "Job taken",
    "Another professional accepted this offer. Check for other jobs.",
  ],
  confirmed: [
    "Booking confirmed",
    "Your booking has been confirmed. Open your booking for details.",
  ],
  received: [
    "Booking received",
    "Your booking is saved. We'll keep you updated.",
  ],
  assigned: ["Cleaner assigned", "A professional has accepted your visit."],
  late: [
    "Arrival update",
    "Your cleaner has sent an arrival update. Open your booking.",
  ],
  reminder: [
    "Booking reminder",
    "Your cleaning visit is coming up. Check your booking for details.",
  ],
  message: [
    "New message",
    "You have a new booking message. Open your inbox to read it.",
  ],
  finding: [
    "Finding your cleaner",
    "We're still finding a cleaner for your visit. Check your booking for updates.",
  ],
  payment: [
    "Payment needs attention",
    "Open your account to check a payment update.",
  ],
};
