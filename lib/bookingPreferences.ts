export const REFERRAL_SOURCES = [
  "Google",
  "Facebook",
  "Instagram",
  "TikTok",
  "Nextdoor",
  "Friend or family",
  "Returning customer",
  "Other",
  "Prefer not to say",
] as const;
export type BookingPreferences = {
  howHeard: string;
  confirmationChannel: "email" | "sms";
  roomsToClean: string;
  accessInstructions: string;
};
export function parseBookingPreferences(value: unknown): BookingPreferences {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const howHeard = body.howHeard ?? "",
    confirmationChannel = body.confirmationChannel ?? "email",
    roomsToClean = body.roomsToClean === undefined ? "" : body.roomsToClean,
    accessInstructions =
      body.accessInstructions === undefined ? "" : body.accessInstructions;
  if (
    typeof howHeard !== "string" ||
    (howHeard && !(REFERRAL_SOURCES as readonly string[]).includes(howHeard))
  )
    throw new Error("Choose how you heard about us.");
  if (confirmationChannel !== "email" && confirmationChannel !== "sms")
    throw new Error("Choose email or SMS confirmations.");
  if (
    typeof roomsToClean !== "string" ||
    roomsToClean.length > 500 ||
    typeof accessInstructions !== "string" ||
    accessInstructions.length > 1000
  )
    throw new Error(
      "Keep the rooms and access instructions within the field limits.",
    );
  return {
    howHeard,
    confirmationChannel,
    roomsToClean: roomsToClean.trim(),
    accessInstructions: accessInstructions.trim(),
  };
}
