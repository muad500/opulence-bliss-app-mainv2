import type { SupabaseClient } from "@supabase/supabase-js";

// The booking address contains the service postcode for current checkouts.
// Older bookings may only have a postcode, or have no parseable postcode.
export function servicePostcodeFromText(value: string | null | undefined): string | null {
  const match = value?.toUpperCase().match(
    /(?:^|[^A-Z0-9])((?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|GIR\s*0AA))(?:$|[^A-Z0-9])/,
  );
  return match ? match[1].replace(/\s+/g, "") : null;
}

export function coversServicePostcode(
  savedPostcodes: string[] | null | undefined,
  servicePostcode: string | null | undefined,
): boolean {
  const postcode = servicePostcodeFromText(servicePostcode);
  if (!savedPostcodes?.length || !postcode) return true;
  const outwardCode = postcode.slice(0, -3);
  return savedPostcodes.some((value) => {
    const covered = value.toUpperCase().replace(/\s+/g, "");
    return covered === postcode || covered === outwardCode;
  });
}

export async function providerIdsWithinSavedCoverage(
  admin: SupabaseClient,
  providerIds: string[],
  servicePostcode: string | null | undefined,
): Promise<string[]> {
  if (!providerIds.length || !servicePostcodeFromText(servicePostcode)) return providerIds;
  const { data, error } = await admin.from("provider_profile_settings")
    .select("provider_id,coverage_postcodes").in("provider_id", providerIds);
  if (error) throw new Error(error.message);
  const settings = new Map((data ?? []).map((row) => [row.provider_id, row.coverage_postcodes as string[]]));
  return providerIds.filter((id) => coversServicePostcode(settings.get(id), servicePostcode));
}
