export type NotificationAudience = "customer" | "professional";
export const notificationTypes: Record<
  NotificationAudience,
  readonly (readonly [string, string, string])[]
> = {
  customer: [
    [
      "booking",
      "Booking updates",
      "Confirmations, assignments, changes and cancellations",
    ],
    ["reminders", "Reminders", "Upcoming visits and session reminders"],
    ["messages", "Messages", "Replies in your booking chat"],
    ["status", "Cleaner status", "Arrival updates and finding your cleaner"],
    [
      "payments",
      "Payments and refunds",
      "Receipts, refunds and payment updates",
    ],
  ],
  professional: [
    ["offers", "New job offers", "New work in your area"],
    ["taken", "Job taken", "When someone else accepts an offer"],
    ["reminders", "Job reminders", "Upcoming jobs and session reminders"],
    ["messages", "Messages", "Replies in your booking chat"],
    ["schedule", "Schedule changes and cancellations", "Changes to your jobs"],
    ["earnings", "Payouts and earnings", "Invoices and payout updates"],
    ["checks", "Account checks", "DBS, right-to-work and insurance expiry"],
  ],
} as const;
export type NotificationChannel = "push" | "email" | "sms";
export type NotificationPreference = {
  audience: NotificationAudience;
  kind: string;
  channel: NotificationChannel;
  enabled: boolean;
};
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validNotificationPreference(
  value: unknown,
): value is NotificationPreference {
  if (!value || typeof value !== "object") return false;
  const p = value as NotificationPreference;
  return (
    (p.audience === "customer" || p.audience === "professional") &&
    notificationTypes[p.audience].some(([kind]) => kind === p.kind) &&
    ["push", "email", "sms"].includes(p.channel) &&
    typeof p.enabled === "boolean"
  );
}
export function promptDue(after: string | null | undefined, now = Date.now()) {
  return (
    !after || (Number.isFinite(Date.parse(after)) && Date.parse(after) <= now)
  );
}
export const essentialEmailNote =
  "Security codes, payment problems, booking changes and cancellations, and check-expiry warnings are Always on (email).";
