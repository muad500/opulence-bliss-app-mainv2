/** New one-off cleaning checkout. Historical authorisations use their own status. */
export const ONE_OFF_PAYMENT_COPY =
  "You're charged when you book. If no cleaner accepts, you're refunded in full automatically.";

/** SetupIntent checkout charges neither the first nor later visits in advance. */
export const REGULAR_PAYMENT_COPY =
  "Your card is saved securely. Each visit is charged once a cleaner accepts it. If no cleaner accepts, you're not charged for that visit.";

/** Older per-visit bookings retain their snapshotted checkout/48-hour schedule. */
export const LEGACY_SCHEDULED_VISIT_PAYMENT_COPY =
  "This earlier booking keeps its original payment schedule. Later visits are charged 48 hours before they start, once a cleaner has accepted, or when a cleaner accepts inside that window. Unassigned and paused visits are not charged.";

/** Keep this separate from the customer charge timing: a cleaner is paid after completion. */
export const CLEANER_PAYOUT_COPY =
  "Your cleaner's payout becomes eligible after the visit is completed. Payouts follow their selected weekly, fortnightly or monthly schedule.";
