// Staging audit fixtures only. Exclude this file from Production merges.
import { appointmentFitsWindow } from "./appointmentWindow";
import { calculateCancellationPolicy } from "./cancellationPolicy";

const cancellationBands = {
  cancellation_full: 100,
  cancellation_75: 75,
  cancellation_50: 50,
  cancellation_same_day: 0,
} as const;

/** Use the real clock and a valid London slot, before creating any test payment. */
export function stagingCancellationFixture(name: string, now = new Date()) {
  if (!Object.hasOwn(cancellationBands, name))
    throw new Error("Unknown staging cancellation case.");
  const refundPercent =
    cancellationBands[name as keyof typeof cancellationBands];
  const halfHour = 30 * 60_000;
  // Leave enough notice for checkout, plus room around the 24/48-hour boundaries.
  const first =
    Math.ceil((now.getTime() + 2.5 * 3_600_000) / halfHour) * halfHour;
  const last = now.getTime() + 5 * 86_400_000;
  for (let time = first; time <= last; time += halfHour) {
    const scheduledAt = new Date(time);
    const hours = (time - now.getTime()) / 3_600_000;
    if (
      (refundPercent === 100 && hours < 49) ||
      (refundPercent === 75 && (hours < 25 || hours > 47)) ||
      (refundPercent === 50 && hours > 23) ||
      !appointmentFitsWindow(scheduledAt, 120)
    )
      continue;
    if (
      calculateCancellationPolicy(scheduledAt, 100, now).refundPercent ===
      refundPercent
    )
      return { scheduledAt, refundPercent };
  }
  throw new Error(
    "The current London clock has no valid slot in this cancellation band. Retry during daytime; no test customer or payment has been created.",
  );
}
