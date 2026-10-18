/** The database is authoritative; this keeps the display aligned between reloads. */
export function visitContactEnd(
  scheduledAt: string,
  minutes: number | null,
  leftAt?: string | null,
) {
  return leftAt
    ? Date.parse(leftAt)
    : Date.parse(scheduledAt) + (minutes ?? 120) * 60_000;
}
export function visitAddressVisible(
  status: string,
  scheduledAt: string,
  minutes: number | null,
  leftAt?: string | null,
  now = Date.now(),
) {
  return (
    ["scheduled", "in_progress"].includes(status) &&
    now < visitContactEnd(scheduledAt, minutes, leftAt)
  );
}
export function visitMessagingOpen(
  status: string,
  assigned: boolean,
  scheduledAt: string,
  minutes: number | null,
  leftAt?: string | null,
  now = Date.now(),
) {
  return (
    assigned &&
    ["scheduled", "in_progress", "completed", "needs_review"].includes(
      status,
    ) &&
    now < visitContactEnd(scheduledAt, minutes, leftAt) + 24 * 3_600_000
  );
}
