import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareCleaningSessions,
  cleaningHourlyRatePence,
  validCleaningDuration,
} from "./cleaningBooking";
import {
  assistantBookingHandoff,
  assistantSlotsForDate,
  normaliseAssistantPostcode,
  type AssistantPackage,
} from "./assistantBooking";
import { permittedAppointmentSlots } from "./appointmentSlots";

export async function assistantServices(db: SupabaseClient) {
  const { data, error } = await db
    .from("packages")
    .select("id, name, price, duration_minutes, service_type, description")
    .eq("active", true)
    .eq("billing_type", "per_visit")
    .ilike("service_type", "%clean%");
  if (error) throw new Error("We could not check services. Please try again.");
  return ((data as AssistantPackage[]) ?? [])
    .sort(compareCleaningSessions)
    .map((pkg) => ({
      ...pkg,
      hourly_rate_gbp: cleaningHourlyRatePence(pkg) / 100,
      pricing_note:
        "Hourly rate per cleaner. Choose 2–8 hours in half-hour steps; checkout confirms the final total.",
    }));
}

export async function assistantCoverage(db: SupabaseClient, postcode: string) {
  const compact = postcode.toUpperCase().replace(/\s/g, "");
  const district =
    compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/)?.[1] ?? compact;
  const { data, error } = await db
    .from("service_areas")
    .select("name, postcode_prefixes")
    .eq("active", true);
  if (error) throw new Error("We could not check coverage. Please try again.");
  const area = (data ?? []).find((row) =>
    (row.postcode_prefixes ?? []).includes(district),
  );
  return {
    covered: !!area,
    area: area?.name,
    district,
    areas_we_cover: (data ?? []).map((row) => row.name),
  };
}

export async function assistantSlots(
  db: SupabaseClient,
  postcode: string,
  minutes: number,
  date?: string,
) {
  if (!validCleaningDuration(minutes))
    throw new Error("Choose 2–8 hours in half-hour steps.");
  const coverage = await assistantCoverage(db, postcode);
  const generated = coverage.covered
    ? permittedAppointmentSlots(minutes).slots
    : [];
  const slots = assistantSlotsForDate(generated, date);
  return {
    ...coverage,
    slots,
    count: slots.length,
    time_zone: "Europe/London",
    workerAvailabilityRequired: false,
  };
}

export async function prepareAssistantBooking(
  db: SupabaseClient,
  input: Record<string, unknown>,
) {
  const postcode = normaliseAssistantPostcode(input.postcode);
  const packages = await assistantServices(db);
  const wanted = String(input.service_name ?? "")
    .trim()
    .toLowerCase();
  const pkg = packages.find(
    (item) =>
      item.id === input.service_id ||
      (wanted && item.name.toLowerCase() === wanted),
  );
  if (!pkg)
    throw new Error("Choose an exact service from the current cleaning list.");
  const coverage = await assistantCoverage(db, postcode);
  if (!coverage.covered)
    throw new Error("We do not currently cover that postcode.");
  return assistantBookingHandoff(pkg, { ...input, postcode });
}
