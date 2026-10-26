import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_CLEANING_BILLING_TERMS,
  parseCleaningBillingTerms,
} from "./cleaningBillingTerms";

export async function currentCleaningBillingTerms(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("cleaning_billing_settings")
    .select("id,terms")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  if (error || !data)
    throw new Error(
      "Booking prices are being updated. Please try again shortly.",
    );
  return parseCleaningBillingTerms({ ...data.terms, version: String(data.id) });
}

export async function bookingCleaningBillingTerms(
  admin: SupabaseClient,
  bookingId: string,
) {
  const { data, error } = await admin
    .from("booking_cleaning_billing_terms")
    .select("terms")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw new Error("Could not load the agreed booking terms.");
  if (!data) return DEFAULT_CLEANING_BILLING_TERMS;
  const rate = await admin.rpc("effective_booking_cleaner_hourly_pence", {
    p_booking: bookingId,
  });
  if (rate.error || !Number.isSafeInteger(rate.data) || rate.data < 1)
    throw new Error("Could not load the agreed cleaner pay.");
  return parseCleaningBillingTerms({
    ...data.terms,
    cleanerHourlyPence: rate.data,
  });
}
