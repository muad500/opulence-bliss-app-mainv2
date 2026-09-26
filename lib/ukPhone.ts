import { parsePhoneNumberFromString } from "libphonenumber-js";

export function getUkPhoneDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidUkPhone(value: unknown) {
  const rawValue = String(value ?? "").trim();
  const digits = getUkPhoneDigits(rawValue);

  if (!/^[\d\s()-]+$/.test(rawValue) || digits.length !== 10) {
    return false;
  }

  const phoneNumber = parsePhoneNumberFromString(`+44${digits}`);
  return phoneNumber?.country === "GB" && phoneNumber.isValid();
}

export function normalizeUkPhone(value: unknown) {
  return `+44${getUkPhoneDigits(value)}`;
}

/** Stored profile numbers use +44 and ten digits, unlike the +44 input field. */
export function isStoredUkPhone(value: unknown) {
  const rawValue = String(value ?? "").trim();
  if (!/^\+44\d{10}$/.test(rawValue)) return false;

  const phoneNumber = parsePhoneNumberFromString(rawValue);
  return phoneNumber?.country === "GB" && phoneNumber.isValid();
}

/** Format a stored UK number for the cleaner's call link. */
export function formatUkPhone(value: unknown) {
  const rawValue = String(value ?? "").trim();
  const match = rawValue.match(/^\+44(\d{4})(\d{6})$/);
  return match ? `+44 ${match[1]} ${match[2]}` : rawValue;
}
