import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { providerIdsWithinSavedCoverage } from "./providerCoverage";
import { rotateBookingOffer } from "./offerRotation";

/** Common matching for old and new billing. Payment retries never relax vetting. */
export async function matchCleaningBookings(
  admin: SupabaseClient,
  bookingIds: string[],
  customerId: string,
  postcode: string,
  serviceType: string | null,
  preferred?: string,
) {
  const compact = postcode.toUpperCase().replace(/\s+/g, "");
  const district = compact.length > 4 ? compact.slice(0, -3) : compact;
  const { data: areas, error: areaError } = await admin
    .from("service_areas")
    .select("id, postcode_prefixes")
    .eq("active", true);
  if (areaError) throw areaError;
  const ids = (areas ?? [])
    .filter((area) => (area.postcode_prefixes ?? []).includes(district))
    .map((area) => area.id);
  let matched: { id: string; profile_id: string }[] = [];
  if (ids.length) {
    const { data: links, error } = await admin
      .from("provider_service_areas")
      .select("provider_id")
      .in("service_area_id", ids);
    if (error) throw error;
    const candidates = [
      ...new Set((links ?? []).map((link) => link.provider_id)),
    ];
    if (candidates.length) {
      let query = admin
        .from("providers")
        .select("id, profile_id")
        .in("id", candidates)
        .eq("vetting_status", "approved")
        .eq("service_approvals->>cleaning", "approved")
        .eq("dbs_verified", true)
        .eq("is_suspended", false);
      if (serviceType) query = query.contains("services", [serviceType]);
      const { data, error } = await query;
      if (error) throw error;
      matched = (data ?? []).filter(
        (provider) => provider.profile_id !== customerId,
      );
      const covered = new Set(
        await providerIdsWithinSavedCoverage(
          admin,
          matched.map((provider) => provider.id),
          postcode,
        ),
      );
      matched = matched.filter((provider) => covered.has(provider.id));
    }
  }
  matched.sort(
    (a, b) => Number(b.id === preferred) - Number(a.id === preferred),
  );
  for (const id of bookingIds) {
    const { error } = await admin.rpc("system_initialize_booking_offer_queue", {
      p_booking_id: id,
      p_provider_ids: matched.map((provider) => provider.id),
    });
    if (error) throw error;
    await rotateBookingOffer(admin, id);
  }
}
