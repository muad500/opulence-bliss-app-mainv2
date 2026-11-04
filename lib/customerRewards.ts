import { londonParts } from "./appointmentWindow";

// Pure policy calculations only. These do not grant/spend rewards or change a
// checkout. The server integration must lock the customer's ledger, use a
// unique booking/operation key and revalidate this plan before moving money.
export const LOYALTY_VISITS_REQUIRED = 10;
export const LOYALTY_FREE_MINUTES = 120;
export const LOYALTY_DISCOUNT_BASIS_POINTS = 500;

function instant(value: string | Date): number {
  const result = new Date(value).getTime();
  if (!Number.isFinite(result))
    throw new Error("A valid reward timestamp is required.");
  return result;
}

function wholeAmount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative safe integer.`);
  return value;
}

function identifier(value: string): void {
  if (!value.trim())
    throw new Error("A reward owner and unique record ID are required.");
}

function londonWallTime(value: number): number {
  const part = londonParts(value);
  const date = new Date(value);
  return Date.UTC(
    part.year,
    part.month - 1,
    part.day,
    part.hour,
    part.minute,
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

/** Calendar months, not 30/180/365-day approximations. Preserve London time,
 * clamp month ends, prefer standard time in an autumn overlap and move forward
 * across a spring gap, matching PostgreSQL's Europe/London interval semantics. */
export function rewardCalendarDeadline(
  value: string | Date,
  months: number,
): string {
  if (!Number.isSafeInteger(months) || months < 0 || months > 120)
    throw new Error("Reward months must be between zero and 120.");
  const original = instant(value);
  if (months === 0) return new Date(original).toISOString();
  const source = new Date(original);
  const part = londonParts(original);
  const first = new Date(Date.UTC(part.year, part.month - 1 + months, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const wall = Date.UTC(
    year,
    month,
    Math.min(part.day, lastDay),
    part.hour,
    part.minute,
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  );
  const candidates = [
    ...new Set(
      [-2, 0, 2].map((days) => {
        const sample = wall + days * 86_400_000;
        return wall - (londonWallTime(sample) - sample);
      }),
    ),
  ];
  const exact = candidates.filter(
    (candidate) => londonWallTime(candidate) === wall,
  );
  return new Date(
    Math.max(...(exact.length ? exact : candidates)),
  ).toISOString();
}

export type RewardHistoryBooking = {
  id: string;
  customerId: string;
  serviceType: string;
  status: string;
  completedAt: string | null;
  paymentSettled: boolean;
  // Settled value includes card payment and redeemed monetary Booking Credit,
  // but excludes free-hour rewards. A wholly free visit is not a paid visit.
  settledPence: number;
  refundedPence: number;
};

export type LoyaltyProgress = {
  qualifyingVisits: number;
  currentWindowVisits: number;
  windowStartedAt: string | null;
  windowExpiresAt: string | null;
  historyAward: {
    earnedAt: string;
    expiresAt: string;
    minutes: number;
  } | null;
  needsInitialAward: boolean;
  fivePercentEligible: boolean;
};

/** Reconstruct from the existing paid/completed visit history, not the feature's
 * launch date or series creation date. Each regular visit is a separate booking.
 * An existing one-off award is recorded independently: refunds must not create
 * another award, or silently renew the original six-month expiry. */
export function customerLoyaltyProgress(input: {
  customerId: string;
  history: readonly RewardHistoryBooking[];
  now: string | Date;
  awardAlreadyRecorded: boolean;
}): LoyaltyProgress {
  identifier(input.customerId);
  const now = instant(input.now);
  const seen = new Set<string>();
  const history = input.history
    .filter((booking) => {
      if (booking.customerId !== input.customerId) return false;
      identifier(booking.id);
      if (seen.has(booking.id))
        throw new Error("Duplicate booking in reward history.");
      seen.add(booking.id);
      wholeAmount(booking.settledPence, "Settled pence");
      wholeAmount(booking.refundedPence, "Refunded pence");
      return (
        booking.serviceType === "cleaning" &&
        booking.status === "completed" &&
        booking.paymentSettled &&
        booking.settledPence > 0 &&
        booking.refundedPence === 0 &&
        booking.completedAt !== null &&
        instant(booking.completedAt) <= now
      );
    })
    .map((booking) => ({ ...booking, time: instant(booking.completedAt!) }))
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  let windowStartedAt: string | null = null;
  let windowExpiresAt: string | null = null;
  let windowVisits = 0;
  let historyAward: LoyaltyProgress["historyAward"] = null;
  for (const booking of history) {
    if (historyAward) break;
    if (!windowExpiresAt || booking.time >= instant(windowExpiresAt)) {
      windowStartedAt = new Date(booking.time).toISOString();
      windowExpiresAt = rewardCalendarDeadline(windowStartedAt, 12);
      windowVisits = 0;
    }
    windowVisits += 1;
    if (windowVisits === LOYALTY_VISITS_REQUIRED) {
      const earnedAt = new Date(booking.time).toISOString();
      historyAward = {
        earnedAt,
        expiresAt: rewardCalendarDeadline(earnedAt, 6),
        minutes: LOYALTY_FREE_MINUTES,
      };
    }
  }
  // An expired incomplete window restarts at the NEXT qualifying visit, not at
  // page load or an arbitrary anniversary. Do not invent a new starting date.
  if (!historyAward && windowExpiresAt && now >= instant(windowExpiresAt)) {
    windowStartedAt = null;
    windowExpiresAt = null;
    windowVisits = 0;
  }
  return {
    qualifyingVisits: history.length,
    currentWindowVisits: windowVisits,
    windowStartedAt,
    windowExpiresAt,
    historyAward,
    needsInitialAward: historyAward !== null && !input.awardAlreadyRecorded,
    // Ten earlier qualifying visits makes the next visit the 11th. Unlike the
    // one-off free hours, this eligibility does not reset after twelve months.
    fivePercentEligible: history.length >= LOYALTY_VISITS_REQUIRED,
  };
}

export type BookingCreditLot = {
  id: string;
  customerId: string;
  issuedAt: string;
  amountPence: number;
  usedPence: number;
  voided: boolean;
};

export type BookingCreditAllocation = {
  lotId: string;
  pence: number;
  expiresAt: string;
};

/** Spend soonest-expiring credit first. Used pence is the NET ledger debit after
 * any previous restoration, not a client-editable balance. Returning credit
 * decreases that debit on the ORIGINAL lot: it never issues a fresh expiry. */
export function planBookingCredit(input: {
  customerId: string;
  lots: readonly BookingCreditLot[];
  bookingPence: number;
  now: string | Date;
  accountClosed: boolean;
}): {
  balancePence: number;
  appliedPence: number;
  cardPence: number;
  allocations: BookingCreditAllocation[];
} {
  identifier(input.customerId);
  let remaining = wholeAmount(input.bookingPence, "Booking pence");
  const now = instant(input.now);
  const seen = new Set<string>();
  const available = input.lots
    .filter((lot) => {
      if (lot.customerId !== input.customerId) return false;
      identifier(lot.id);
      if (seen.has(lot.id)) throw new Error("Duplicate Booking Credit lot.");
      seen.add(lot.id);
      wholeAmount(lot.amountPence, "Credit pence");
      wholeAmount(lot.usedPence, "Used credit pence");
      if (lot.usedPence > lot.amountPence)
        throw new Error("Credit is overspent.");
      return (
        !input.accountClosed &&
        !lot.voided &&
        instant(lot.issuedAt) <= now &&
        instant(rewardCalendarDeadline(lot.issuedAt, 12)) > now
      );
    })
    .map((lot) => ({
      ...lot,
      expiresAt: rewardCalendarDeadline(lot.issuedAt, 12),
    }))
    .sort(
      (a, b) =>
        instant(a.expiresAt) - instant(b.expiresAt) || a.id.localeCompare(b.id),
    );
  let balancePence = 0;
  const allocations: BookingCreditAllocation[] = [];
  for (const lot of available) {
    const balance = lot.amountPence - lot.usedPence;
    balancePence = wholeAmount(balancePence + balance, "Total credit pence");
    const pence = Math.min(remaining, balance);
    if (pence)
      allocations.push({ lotId: lot.id, pence, expiresAt: lot.expiresAt });
    remaining -= pence;
  }
  return {
    balancePence,
    appliedPence: input.bookingPence - remaining,
    cardPence: remaining,
    allocations,
  };
}

export function availableLoyaltyMinutes(input: {
  earnedAt: string;
  usedMinutes: number;
  accountClosed: boolean;
  now: string | Date;
}): number {
  const used = wholeAmount(input.usedMinutes, "Used reward minutes");
  if (used > LOYALTY_FREE_MINUTES)
    throw new Error("Free-hours reward is overspent.");
  const now = instant(input.now);
  return !input.accountClosed &&
    instant(input.earnedAt) <= now &&
    instant(rewardCalendarDeadline(input.earnedAt, 6)) > now
    ? LOYALTY_FREE_MINUTES - used
    : 0;
}
