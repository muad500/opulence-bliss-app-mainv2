import {
  appointmentFitsWindow,
  appointmentWithinBookingHorizon,
  londonDateKey,
} from "./appointmentWindow";
import {
  bookingPricePence,
  cleaningHourlyRatePence,
  validCleaningDuration,
} from "./cleaningBooking";
import { normaliseOptionalBookingTimes } from "./bookingTimeChoices";
import {
  isRegularVisitCount,
  regularVisitSlots,
  type RegularFrequency,
} from "./regularBooking";
import { bookingPolicyError } from "./bookingPolicy";

export type AssistantPackage = {
  id: string;
  name: string;
  price: number | string;
  duration_minutes: number | null;
  service_type: string | null;
  description?: string | null;
};

export function normaliseAssistantPostcode(value: unknown) {
  const compact = String(value ?? "")
    .toUpperCase()
    .replace(/\s/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) {
    throw new Error("Enter your full UK postcode, for example SW3 1AA.");
  }
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function validAssistantSlot(
  slot: string,
  minutes: number,
  now = Date.now(),
) {
  return (
    validCleaningDuration(minutes) &&
    appointmentFitsWindow(slot, minutes) &&
    appointmentWithinBookingHorizon(slot, now) &&
    new Date(slot).getTime() >= now + 2 * 60 * 60 * 1000
  );
}

/** A handoff is a draft only. Checkout revalidates every field before payment. */
export function assistantBookingHandoff(
  pkg: AssistantPackage,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const postcode = normaliseAssistantPostcode(input.postcode);
  const minutes = Number(input.duration_minutes ?? pkg.duration_minutes ?? 120);
  const slot = String(input.slot ?? "");
  if (!validAssistantSlot(slot, minutes, now)) {
    throw new Error(
      "Choose a permitted time at least two hours from now, with 2–8 cleaning hours.",
    );
  }
  const frequency = String(input.frequency ?? "one_time");
  if (!["one_time", "weekly", "fortnightly", "monthly"].includes(frequency)) {
    throw new Error("Choose a valid visit frequency.");
  }
  const regular = frequency !== "one_time";
  const policyError = bookingPolicyError(pkg.name, frequency);
  if (policyError) throw new Error(policyError);
  const visits = regular ? Number(input.visits ?? 6) : 1;
  if (regular) {
    if (!isRegularVisitCount(visits))
      throw new Error("Regular cleaning needs 6 to 10 visits.");
    regularVisitSlots(
      slot,
      frequency as RegularFrequency,
      minutes,
      now,
      visits,
    );
    if (
      input.optional_slots != null &&
      (!Array.isArray(input.optional_slots) || input.optional_slots.length)
    ) {
      throw new Error(
        "Optional times are available for one-off bookings only.",
      );
    }
  }
  const optional = regular
    ? []
    : normaliseOptionalBookingTimes(input.optional_slots, slot, minutes, now);
  if (optional.some((time) => !validAssistantSlot(time, minutes, now))) {
    throw new Error(
      "Every optional time must have at least two hours' notice.",
    );
  }
  const params = new URLSearchParams({
    review: "1",
    source: "assistant",
    service: pkg.id,
    pc: postcode,
    slot: new Date(slot).toISOString(),
    duration: String(minutes),
    frequency,
    visits: String(visits),
  });
  for (const time of optional) params.append("optional", time);
  const visitPence = bookingPricePence(pkg, minutes);
  return {
    url: `/book?${params}`,
    service: pkg.name,
    postcode,
    duration_minutes: minutes,
    frequency,
    visits,
    preferred_time: new Date(slot).toISOString(),
    optional_times: optional,
    hourly_rate_gbp: cleaningHourlyRatePence(pkg) / 100,
    price_per_visit_gbp: visitPence / 100,
    total_gbp: (visitPence * visits) / 100,
    note: "This is a draft. Review your address, home details and final price in checkout. A cleaner is matched after booking; nothing is booked or paid by this chat.",
  };
}

export function assistantSlotsForDate(slots: string[], date?: string) {
  return date ? slots.filter((slot) => londonDateKey(slot) === date) : slots;
}

/** Allow only local links; an AI response must never supply executable URLs. */
export function safeAssistantHref(raw: string, origin?: string) {
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(raw)
  ) {
    if (!origin || !/^https?:\/\//i.test(raw)) return null;
    try {
      const url = new URL(raw);
      if (url.origin !== origin) return null;
      return url.pathname + url.search + url.hash;
    } catch {
      return null;
    }
  }
  return raw;
}
