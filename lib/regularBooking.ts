import {
  appointmentFitsWindow,
  appointmentWithinBookingHorizon,
  londonDate,
  londonParts,
} from "./appointmentWindow";

// The client's rule: a regular booking is 6 to 10 visits booked and paid
// together, weekly, every two weeks or monthly. Booking visits one at a time is
// a one-off booking at the one-off rate.
export const REGULAR_MIN_VISITS = 6;
export const REGULAR_MAX_VISITS = 10;
export type RegularFrequency = "weekly" | "fortnightly" | "monthly";

export function isRegularVisitCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= REGULAR_MIN_VISITS && (value as number) <= REGULAR_MAX_VISITS;
}

/** Keep the chosen London wall-clock time across BST/GMT changes. */
export function regularVisitSlots(
  firstSlot: string,
  frequency: RegularFrequency,
  durationMinutes: number,
  now: Date | string | number = Date.now(),
  visits: number = REGULAR_MIN_VISITS,
): string[] {
  if (frequency !== "weekly" && frequency !== "fortnightly" && frequency !== "monthly") {
    throw new Error("Choose weekly, every two weeks or monthly for a regular booking.");
  }
  if (!isRegularVisitCount(visits)) {
    throw new Error(`Choose between ${REGULAR_MIN_VISITS} and ${REGULAR_MAX_VISITS} visits.`);
  }
  const first = new Date(firstSlot);
  if (!appointmentFitsWindow(first, durationMinutes)) {
    throw new Error("Choose a valid first appointment time.");
  }
  const anchor = londonParts(first);
  const slots: string[] = [];
  for (let index = 0; index < visits; index += 1) {
    let date: Date;
    if (frequency === "weekly" || frequency === "fortnightly") {
      const step = frequency === "weekly" ? 7 : 14;
      const day = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + step * index));
      date = londonDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), anchor.hour, anchor.minute);
    } else {
      const month = new Date(Date.UTC(anchor.year, anchor.month - 1 + index, 1));
      const year = month.getUTCFullYear();
      const monthNumber = month.getUTCMonth() + 1;
      const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      date = londonDate(year, monthNumber, Math.min(anchor.day, lastDay), anchor.hour, anchor.minute);
    }
    if (!appointmentFitsWindow(date, durationMinutes) || !appointmentWithinBookingHorizon(date, now)) {
      throw new Error("All visits must fall within one year and finish by 8:00 pm. Choose an earlier first date, a time, or fewer visits.");
    }
    slots.push(date.toISOString());
  }
  if (slots[0] !== first.toISOString()) {
    throw new Error("Choose a valid London appointment time.");
  }
  return slots;
}

/** Spread a single captured charge across the visit ledgers without losing pennies. */
export function allocateRegularPayment(grossPence: number, platformPence: number, visits: number = REGULAR_MIN_VISITS) {
  if (!Number.isInteger(grossPence) || !Number.isInteger(platformPence) || !isRegularVisitCount(visits) ||
      grossPence <= 0 || platformPence < 0 || platformPence >= grossPence) {
    throw new Error("Invalid regular payment allocation.");
  }
  const split = (total: number) => Array.from(
    { length: visits },
    (_, index) => Math.floor(total / visits) + (index < total % visits ? 1 : 0),
  );
  const gross = split(grossPence);
  const platform = split(platformPence);
  if (gross.some((amount, index) => amount <= 0 || platform[index] >= amount)) {
    throw new Error("Invalid regular payment allocation.");
  }
  return gross.map((amount, index) => ({
    grossPence: amount,
    platformPence: platform[index],
    providerPence: amount - platform[index],
  }));
}
