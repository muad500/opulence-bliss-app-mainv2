import { parsePhoneNumberFromString } from "libphonenumber-js";
import { isStoredUkPhone } from "./ukPhone";
import { PARTNER_INTEREST_DESCRIPTIONS } from "./partnerInterestCopy";

export type PartnerInterestInput = {
  fullName: string;
  email: string;
  phone: string;
  description: (typeof PARTNER_INTEREST_DESCRIPTIONS)[number];
};

export function partnerInterestInput(
  value: unknown,
):
  | { input: PartnerInterestInput; fields?: never }
  | { input?: never; fields: Record<string, string> } {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const fields: Record<string, string> = {};
  const fullName =
    typeof body.fullName === "string"
      ? body.fullName.trim().replace(/\s+/g, " ")
      : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  const parsed =
    rawPhone.length <= 40 && /^[+\d\s()-]+$/.test(rawPhone)
      ? parsePhoneNumberFromString(rawPhone, "GB")
      : undefined;
  const phone = parsed?.number ?? "";
  const description =
    typeof body.description === "string" ? body.description : "";
  if (
    fullName.length < 2 ||
    fullName.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(fullName)
  )
    fields.fullName = "Please enter your full name.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))
    fields.email = "Please enter a valid email address.";
  if (!isStoredUkPhone(phone))
    fields.phone = "Please enter a valid phone number.";
  if (
    !PARTNER_INTEREST_DESCRIPTIONS.includes(
      description as PartnerInterestInput["description"],
    )
  )
    fields.description = "Please choose the option that best describes you.";
  if (body.consent !== true)
    fields.consent =
      "Please tick the box so we can contact you about the partnership.";
  return Object.keys(fields).length
    ? { fields }
    : {
        input: {
          fullName,
          email,
          phone,
          description: description as PartnerInterestInput["description"],
        },
      };
}
