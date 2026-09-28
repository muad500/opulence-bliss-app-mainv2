import { londonDate, londonParts } from "./appointmentWindow";

/**
 * Consumer Contracts Regulations 2013. A customer booking online may cancel
 * within 14 days (reg. 29), and the period ends at the end of the 14th day
 * after the day the contract is made (reg. 30). A service may only begin inside
 * that period at the customer's express request, given with an acknowledgement
 * that the right to cancel ends once the service is fully performed (reg. 36).
 */
export const CANCELLATION_PERIOD_DAYS = 14;

/** The first moment after the cancellation period: London midnight at its end. */
export function cancellationPeriodEnd(contractAt: Date | string | number = new Date()) {
  const day = londonParts(contractAt);
  return londonDate(day.year, day.month, day.day + CANCELLATION_PERIOD_DAYS + 1, 0, 0);
}

/** True when a visit would begin inside the customer's cancellation period. */
export function startsWithinCancellationPeriod(
  startAt: Date | string | number,
  contractAt: Date | string | number = new Date(),
) {
  return new Date(startAt).getTime() < cancellationPeriodEnd(contractAt).getTime();
}

/** The wording the customer agrees to. Kept here so the page and records match. */
export const EARLY_START_REQUEST_TEXT =
  "I ask for my service to start within my 14-day cancellation period. " +
  "I understand that I lose my right to cancel once the service has been fully provided, " +
  "and that if I cancel after it has started I will pay for the part already provided.";
