export type BookingFrequency = "one_time" | "weekly" | "fortnightly" | "monthly";

export function isBookingFrequency(value: string): value is BookingFrequency {
  return ["one_time", "weekly", "fortnightly", "monthly"].includes(value);
}

/** A regular price must never be used for a single-visit checkout. */
export function bookingPolicyError(packageName: string, frequency: string): string | null {
  if (!isBookingFrequency(frequency)) {
    return "Choose a valid cleaning frequency.";
  }

  if (frequency !== "one_time" && packageName !== "Essential Clean") {
    return "Regular bookings use Essential Clean. Choose Essential Clean for six to ten visits, or book this session once.";
  }

  if (packageName === "Essential Clean") {
    if (frequency === "one_time") {
      return "Essential Clean is our regular rate for six to ten visits booked together. For one visit, choose One-Time Essential Clean.";
    }
  }

  return null;
}
