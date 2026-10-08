import { createHash } from "node:crypto";
import { normaliseAssistantPostcode } from "./assistantBooking";
import { parseCleaningHome } from "./cleaningHome";
import { isStoredUkPhone, isValidUkPhone, normalizeUkPhone } from "./ukPhone";

export class VoiceBookingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string") throw new VoiceBookingError(`Confirm the ${label}.`);
  const result = value.trim().replace(/\s+/g, " ");
  if (result.length < min || result.length > max) throw new VoiceBookingError(`Confirm the ${label}.`);
  return result;
}

/** Spoken details are never an account identity or a price supplied by the AI. */
export function voiceBookingDetails(args: Record<string, unknown>) {
  if (args.confirmed !== true) throw new VoiceBookingError("Read back the details and price and obtain the caller's confirmation first.");
  const email = text(args.email, "email address", 5, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) throw new VoiceBookingError("Confirm a valid email address.");
  const phone = text(args.phone, "UK contact number", 10, 30);
  if (!/^[+\d\s()-]+$/.test(phone)) throw new VoiceBookingError("Confirm a valid UK contact number.");
  const digits = phone.replace(/\D/g, "");
  const storedPhone = isStoredUkPhone(phone) ? phone
    : normalizeUkPhone(digits.startsWith("44") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits);
  if (!isStoredUkPhone(storedPhone) || (!isStoredUkPhone(phone) && !isValidUkPhone(storedPhone.slice(3)))) {
    throw new VoiceBookingError("Confirm a valid UK contact number for the cleaner. An Indian test number cannot be used as the UK service contact.");
  }
  const home = parseCleaningHome({ propertyType: args.property_type, bedrooms: args.bedrooms, bathrooms: args.bathrooms });
  if (!home) throw new VoiceBookingError("Confirm the property type, bedrooms and bathrooms.");
  const slot = text(args.slot, "chosen appointment time", 20, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(slot) || !Number.isFinite(Date.parse(slot))) {
    throw new VoiceBookingError("Use the exact appointment timestamp returned by check_booking_options.");
  }
  if (typeof args.duration_minutes !== "number" || typeof args.visits !== "number") throw new VoiceBookingError("Confirm the duration and visit count.");
  if (args.frequency === "one_time" && args.visits !== 1) throw new VoiceBookingError("A one-off booking has exactly one visit.");
  return {
    customer_name: text(args.customer_name, "customer name", 2, 120),
    email, phone: storedPhone,
    service_id: text(args.service_id, "service", 1, 100),
    postcode: normaliseAssistantPostcode(args.postcode),
    address: text(args.address, "full service address", 5, 400),
    home, slot: new Date(slot).toISOString(),
    duration_minutes: args.duration_minutes,
    frequency: text(args.frequency, "visit frequency", 6, 20),
    visits: args.visits,
    request: args.request == null ? "" : text(args.request, "special requests", 0, 250),
  };
}

export type VoiceDetails = ReturnType<typeof voiceBookingDetails>;
export function voiceBookingFingerprint(agentId: string, callId: string, details: VoiceDetails) {
  return createHash("sha256").update(JSON.stringify([agentId, callId, details])).digest("hex");
}

export function ownsVoiceBooking(email: string | undefined, confirmedAt: string | undefined, id: string, row: { email: string; customer_id: string | null }) {
  return !!email && !!confirmedAt && email.toLowerCase() === row.email.toLowerCase() && (!row.customer_id || row.customer_id === id);
}

export function escapeVoiceHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function voiceCheckoutBody(details: VoiceDetails, earlyStartRequested: boolean) {
  return {
    packageId: details.service_id, postcode: details.postcode, address: details.address,
    home: details.home, slot: details.slot, durationMinutes: details.duration_minutes,
    frequency: details.frequency, regularVisits: details.visits, request: details.request,
    phone: details.phone.slice(3), earlyStartRequested,
  };
}
