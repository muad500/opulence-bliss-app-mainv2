import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareOfferLocations } from "@/lib/jobOfferLocations";

export type OfferRotationResult = {
  action:
    | "wave_opened"
    | "waiting"
    | "paused"
    | "hard_deadline"
    | "closed"
    | "no_queue"
    | "missing_booking";
  wave?: number;
  opened?: number;
  second_wave_due_at?: string;
};

export async function rotateBookingOffer(
  admin: SupabaseClient,
  bookingId: string,
) {
  // Notification deduplication and the wave clock live in the database, so a
  // retry, browser disconnect or serverless restart cannot send a wave twice.
  await prepareOfferLocations(admin, bookingId);
  const { data, error } = await admin.rpc("system_rotate_booking_offer", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(error.message);
  return data as OfferRotationResult;
}

export async function seedAndStartOfferRotation(
  admin: SupabaseClient,
  bookingId: string,
  providerIds: string[],
) {
  const { data, error } = await admin.rpc("system_seed_booking_offer_queue", {
    p_booking_id: bookingId,
    p_provider_ids: providerIds,
  });
  if (error) throw new Error(error.message);
  const started = await rotateBookingOffer(admin, bookingId);
  return { seed: data, started };
}
