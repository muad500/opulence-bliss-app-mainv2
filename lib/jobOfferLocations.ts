import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cache district centres; neither full private postcodes nor addresses leave Supabase. */
export async function prepareOfferLocations(
  admin: SupabaseClient,
  bookingId: string,
) {
  const { data, error } = await admin.rpc("system_offer_missing_outcodes", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(error.message);
  const districts = (data ?? []) as { outcode: string }[];
  // Bound checkout work. Missing coordinates never exclude an otherwise eligible cleaner.
  const expires = Date.now() + 3500;
  for (let offset = 0; offset < districts.length; offset += 8) {
    if (Date.now() >= expires) break;
    await Promise.all(
      districts.slice(offset, offset + 8).map(async ({ outcode }) => {
        if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(outcode)) return;
        try {
          const response = await fetch(
            `https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`,
            {
              signal: AbortSignal.timeout(Math.max(1, expires - Date.now())),
              next: { revalidate: 86400 },
            },
          );
          if (!response.ok) return;
          const { result } = await response.json();
          if (
            !Number.isFinite(result?.latitude) ||
            !Number.isFinite(result?.longitude)
          )
            return;
          const { error: saveError } = await admin
            .from("offer_geo_outcodes")
            .upsert({
              outcode,
              latitude: result.latitude,
              longitude: result.longitude,
              updated_at: new Date().toISOString(),
            });
          if (saveError) throw saveError;
        } catch {
          // A geocoder outage removes location points, never offers or eligibility checks.
        }
      }),
    );
  }
}
