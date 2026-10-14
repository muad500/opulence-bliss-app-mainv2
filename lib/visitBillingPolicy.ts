export const VISIT_CHARGE_NOTICE_HOURS = 48;
export const VISIT_PAYMENT_DEADLINE_HOURS = 24;
export const VISIT_CHANGE_NOTICE_HOURS = 24;
export const MINIMUM_TIP_PENCE = 300;

export function visitChargeDueAt(scheduledAt: string) {
  const time = new Date(scheduledAt).getTime();
  if (!Number.isFinite(time)) throw new Error("Invalid visit time.");
  return new Date(time - VISIT_CHARGE_NOTICE_HOURS * 3_600_000).toISOString();
}
export function unpaidVisitMustCancel(scheduledAt: string, now = Date.now()) {
  return (
    new Date(scheduledAt).getTime() - now <=
    VISIT_PAYMENT_DEADLINE_HOURS * 3_600_000
  );
}
export function visitExtrasCanChange(scheduledAt: string, now = Date.now()) {
  return (
    new Date(scheduledAt).getTime() - now >=
    VISIT_CHANGE_NOTICE_HOURS * 3_600_000
  );
}
export function visitBillingEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.CLEANING_PAY_PER_VISIT_ENABLED === "true";
}

export type VisitLine = {
  id: string;
  label: string;
  amountPence: number;
  reservedMinutes: number;
};
export function assertVisitLines(lines: VisitLine[]) {
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    new Set(lines.map((line) => line.id)).size !== lines.length ||
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.amountPence) ||
        line.amountPence < 0 ||
        !Number.isInteger(line.reservedMinutes) ||
        line.reservedMinutes < 0,
    )
  )
    throw new Error("Invalid visit line items.");
  const duration = lines.reduce((sum, line) => sum + line.reservedMinutes, 0);
  if (duration < 120 || duration > 480 || duration % 30 !== 0)
    throw new Error("The full visit must fit within eight hours.");
}
