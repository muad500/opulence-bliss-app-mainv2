export const PROPERTY_TYPES = ["studio", "flat", "house", "other"] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export type CleaningHome = {
  propertyType: PropertyType;
  bedrooms: number;
  bathrooms: number;
};

export function parseCleaningHome(value: unknown): CleaningHome | null {
  if (!value || typeof value !== "object") return null;
  const details = value as Record<string, unknown>;
  const propertyType = details.propertyType;
  const bedrooms = details.bedrooms;
  const bathrooms = details.bathrooms;
  if (
    !PROPERTY_TYPES.includes(propertyType as PropertyType) ||
    typeof bedrooms !== "number" ||
    !Number.isInteger(bedrooms) ||
    bedrooms < 0 ||
    bedrooms > 8 ||
    typeof bathrooms !== "number" ||
    !Number.isInteger(bathrooms) ||
    bathrooms < 1 ||
    bathrooms > 8 ||
    (propertyType === "studio" && bedrooms !== 0)
  )
    return null;
  return { propertyType: propertyType as PropertyType, bedrooms, bathrooms };
}

/** Planning guide only. Customers can choose any permitted duration. */
export function recommendedCleaningMinutesForHome(
  home: CleaningHome,
  packageName?: string,
) {
  const bedroomsAfterFirst = Math.max(0, home.bedrooms - 1);
  const bathroomsAfterFirst = home.bathrooms - 1;
  const houseAllowance = home.propertyType === "house" ? 30 : 0;
  const estimate = Math.min(
    480,
    120 + 30 * (bedroomsAfterFirst + bathroomsAfterFirst) + houseAllowance,
  );
  // The client's Essential Clean guide starts at four hours for 3+ bedrooms.
  // This remains a suggestion; it does not change permitted booking durations.
  return packageName === "Essential Clean" && home.bedrooms >= 3
    ? Math.max(240, estimate)
    : estimate;
}

export function cleaningHomeLabel(home: CleaningHome) {
  const type = home.propertyType[0].toUpperCase() + home.propertyType.slice(1);
  return `${type}, ${home.bedrooms} ${home.bedrooms === 1 ? "bedroom" : "bedrooms"}, ${home.bathrooms} ${home.bathrooms === 1 ? "bathroom" : "bathrooms"}`;
}

export function bookingNotesForHome(home: CleaningHome, request: string) {
  const notes = request.trim().replace(/\s+/g, " ").slice(0, 250);
  return `Home details: ${cleaningHomeLabel(home)}${notes ? `\nRequests: ${notes}` : ""}`;
}

export function splitBookingHomeNotes(notes: string | null) {
  const match = notes?.match(
    /^Home details: ([^\n]+)(?:\nRequests: ([\s\S]*))?$/,
  );
  return match
    ? { home: match[1], request: match[2] ?? "" }
    : { home: null, request: notes ?? "" };
}
