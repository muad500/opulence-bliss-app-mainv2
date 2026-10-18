export type ChargeEligibility = {
  allowed: boolean;
  reason: string | null;
  assigned: boolean;
  paused: boolean;
};

export function matchingStage(scheduledAt: string, now = Date.now()) {
  const remaining = new Date(scheduledAt).getTime() - now;
  if (!Number.isFinite(remaining)) throw new Error("Invalid visit time.");
  if (remaining <= 2 * 3_600_000) return "deadline";
  if (remaining <= 24 * 3_600_000) return "customer_warning";
  if (remaining <= 48 * 3_600_000) return "admin_alert";
  return "finding";
}

/** Late acceptance may have a bounded card-update window. It never extends
 * beyond three hours before the visit, even if supplied an invalid deadline. */
export function assignedPaymentMustCancel(
  scheduledAt: string,
  assigned: boolean,
  attempts: number,
  now = Date.now(),
  graceUntil: string | null = null,
) {
  const graceEnd = Math.min(
    new Date(graceUntil ?? "").getTime(),
    new Date(scheduledAt).getTime() - 3 * 3_600_000,
  );
  return (
    assigned &&
    attempts > 0 &&
    new Date(scheduledAt).getTime() - now <= 24 * 3_600_000 &&
    !(graceEnd > now)
  );
}
