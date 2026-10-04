import {
  APPOINTMENT_START_HOUR,
  APPOINTMENT_END_HOUR,
  BOOKING_HORIZON_YEARS,
  appointmentFitsWindow,
  londonDate,
  londonParts,
} from "./appointmentWindow";

/** Shared by the booking form and assistant; these are selectable times, not worker guarantees. */
export function permittedAppointmentSlots(
  durationMinutes: number,
  now = Date.now(),
) {
  const horizon = new Date(now);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + BOOKING_HORIZON_YEARS);
  const slots: string[] = [];
  const today = londonParts(now);
  for (let d = 0; d <= 366; d++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
    for (
      let minute = APPOINTMENT_START_HOUR * 60;
      minute <= APPOINTMENT_END_HOUR * 60;
      minute += 30
    ) {
      const slot = londonDate(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        Math.floor(minute / 60),
        minute % 60,
      );
      if (slot.getTime() < now + 2 * 60 * 60 * 1000 || slot > horizon) continue;
      if (appointmentFitsWindow(slot, durationMinutes))
        slots.push(slot.toISOString());
    }
  }
  return { slots, horizon };
}
