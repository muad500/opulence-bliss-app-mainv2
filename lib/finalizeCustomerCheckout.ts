import "server-only";
import type Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { isCleaning, validCleaningDuration } from "@/lib/cleaningBooking";
import { appointmentFitsWindow, APPOINTMENT_WINDOW_MESSAGE } from "@/lib/appointmentWindow";
import { rotateBookingOffer } from "@/lib/offerRotation";
import { normaliseOptionalBookingTimes } from "@/lib/bookingTimeChoices";
import { allocateRegularPayment, isRegularVisitCount, regularVisitSlots, type RegularFrequency } from "@/lib/regularBooking";
import { bookingPolicyError, isBookingFrequency } from "@/lib/bookingPolicy";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Used by both the browser return and the verified Stripe webhook. */
export async function finalizeCustomerCheckout(session: Stripe.Checkout.Session, pi: Stripe.PaymentIntent) {
  const customerId = session.client_reference_id;
  if (!customerId || pi.metadata.customer_id !== customerId || pi.metadata.kind !== "booking" ||
      !["requires_capture", "succeeded"].includes(pi.status)) throw new Error("Invalid customer checkout.");
  const { data: customer, error: customerError } = await admin.from("profiles").select("email, role").eq("id", customerId).single();
  if (customerError || customer?.role !== "customer") throw new Error("Customer account not found.");
  const m = pi.metadata ?? {};
  const packageId = m.package_id || null;
  const postcode = m.postcode || null;
  const request = m.request || null;
  const frequency = m.booking_frequency || "one_time";
  const regular = m.upfront_regular === "1";
  const { data: stagedChoicesData } = await admin
    .from("booking_checkout_time_choices")
    .select(regular
      ? "preferred_scheduled_at, optional_scheduled_at, regular_scheduled_at"
      : "preferred_scheduled_at, optional_scheduled_at")
    .eq("checkout_session_id", session.id)
    .eq("customer_id", customerId)
    .maybeSingle();
  const stagedChoices = stagedChoicesData as unknown as {
    preferred_scheduled_at: string;
    optional_scheduled_at: string[];
    regular_scheduled_at?: string[];
  } | null;
  const slot = stagedChoices?.preferred_scheduled_at || m.slot || null;
  const serviceAddress = m.service_address?.trim() || null;

  const { data: pkgRow } = await admin
    .from("packages")
    .select("name, service_type, duration_minutes")
    .eq("id", packageId ?? "")
    .maybeSingle();
  const serviceType = pkgRow?.service_type ?? null;
  const minutes = Number(m.duration_minutes);
  if (isCleaning(serviceType) && !validCleaningDuration(minutes)) {
    throw new Error("Invalid cleaning duration.");
  }
  if (!serviceAddress || !isBookingFrequency(frequency)) {
    throw new Error("Invalid booking address or frequency.");
  }
  if (!pkgRow || bookingPolicyError(m.package ?? pkgRow.name, frequency) || regular !== (frequency !== "one_time")) {
    throw new Error("This checkout does not match the cleaning booking policy.");
  }
  if (!slot || !appointmentFitsWindow(slot, minutes)) {
    throw new Error(APPOINTMENT_WINDOW_MESSAGE);
  }
  let optionalSlots: string[];
  try {
    optionalSlots = normaliseOptionalBookingTimes(
      stagedChoices?.optional_scheduled_at ?? JSON.parse(m.optional_slots || "[]"),
      slot,
      minutes,
      null,
    );
  } catch {
    throw new Error("Invalid optional booking times.");
  }
  if (regular && optionalSlots.length > 0) throw new Error("Regular visits cannot use optional times.");
  let regularSlots: string[] = [];
  let regularAmounts: ReturnType<typeof allocateRegularPayment> = [];
  if (regular) {
    if (pi.status !== "succeeded" || pi.amount_received !== pi.amount || pi.capture_method !== "automatic") {
      throw new Error("Regular upfront visits require a completed payment.");
    }
    const visitCount = Number(m.regular_visit_count);
    if (!isRegularVisitCount(visitCount)) throw new Error("Invalid number of regular visits.");
    regularSlots = regularVisitSlots(slot, frequency as RegularFrequency, minutes, session.created * 1000, visitCount);
    const staged = stagedChoices?.regular_scheduled_at ?? [];
    if (staged.length !== regularSlots.length ||
        staged.some((value: string, index: number) => new Date(value).getTime() !== new Date(regularSlots[index]).getTime())) {
      throw new Error("Regular visit dates were not saved with this checkout.");
    }
    const perVisitGross = Number(m.per_visit_gross);
    const discount = Number(m.discount);
    const platform = Number(m.platform_margin);
    if (!Number.isInteger(perVisitGross) || !Number.isInteger(discount) ||
        discount < 0 || pi.amount !== perVisitGross * regularSlots.length - discount) {
      throw new Error("Regular checkout amount does not match its schedule.");
    }
    regularAmounts = allocateRegularPayment(pi.amount, platform, regularSlots.length);
  }
  const platformMarginPence = pi.application_fee_amount ?? Number(m.platform_margin);
  if (!Number.isInteger(platformMarginPence) || platformMarginPence < 0 ||
      platformMarginPence >= pi.amount ||
      (!regular && Number(m.provider_amount) !== pi.amount - platformMarginPence)) {
    throw new Error("Booking payment allocation is invalid.");
  }
  const compact = (postcode ?? "").toUpperCase().replace(/\s+/g, "");
  const district = compact.length > 4 ? compact.slice(0, compact.length - 3) : compact;

  const { data: allAreas } = await admin
    .from("service_areas")
    .select("id, postcode_prefixes")
    .eq("active", true);
  const areaIds = (allAreas ?? [])
    .filter((a) => (a.postcode_prefixes ?? []).includes(district))
    .map((a) => a.id);

  let candidateIds: string[] = [];
  if (areaIds.length) {
    const { data: links } = await admin
      .from("provider_service_areas")
      .select("provider_id")
      .in("service_area_id", areaIds);
    candidateIds = [...new Set((links ?? []).map((link) => link.provider_id))];
  }

  let matched: { id: string; profile_id: string }[] = [];
  if (candidateIds.length) {
    let query = admin
      .from("providers")
      .select("id, profile_id")
      .in("id", candidateIds)
      .eq("vetting_status", "approved")
      .eq("dbs_verified", true)
      .eq("is_suspended", false);
    if (serviceType) query = query.contains("services", [serviceType]);
    const { data } = await query;
    matched = data ?? [];
  }

  // Both database functions lock the checkout reference. The six inserts and
  // their payment allocations commit together, or none of them do.
  const { data: saved, error: bookingError } = regular
    ? await admin.rpc("finalize_regular_customer_checkout", {
        p_customer_id: customerId,
        p_session_id: session.id,
        p_payment_ref: pi.id,
        p_package_id: packageId,
        p_postcode: postcode,
        p_address: serviceAddress,
        p_request: request,
        p_slots: regularSlots,
        p_duration_minutes: minutes,
        p_frequency: frequency,
        p_preferred_provider_id: m.preferred_provider_id || null,
        p_total_pence: pi.amount,
        p_platform_pence: Number(m.platform_margin),
        p_amounts: regularAmounts.map((amount) => amount.grossPence),
        p_platforms: regularAmounts.map((amount) => amount.platformPence),
        p_email: customer?.email ?? null,
      })
    : await admin.rpc("finalize_customer_checkout", {
        p_customer_id: customerId,
        p_session_id: session.id,
        p_payment_ref: pi.id,
        p_package_id: packageId,
        p_postcode: postcode,
        p_address: serviceAddress,
        p_request: request,
        p_slot: slot,
        p_optional_slots: optionalSlots,
        p_duration_minutes: minutes,
        p_property_size_sqm: null,
        p_frequency: frequency,
        p_preferred_provider_id: m.preferred_provider_id || null,
        p_amount: pi.amount / 100,
        p_platform: platformMarginPence / 100,
        p_email: customer?.email ?? null,
        p_payment_status: pi.status === "succeeded" ? "succeeded" : "authorised",
      });
  const bookingIds = regular ? saved as string[] : [saved as string];
  if (bookingError || !bookingIds?.length || bookingIds.some((id) => !id)) {
    throw bookingError ?? new Error("Booking insert failed");
  }

  // Record the customer's express request to start within the cancellation
  // period on each booking. Checkout required it and stored it on the payment;
  // failing to copy it here must not lose a paid booking, so it only logs.
  if (m.early_start_requested_at) {
    const { error: earlyStartError } = await admin
      .from("bookings")
      .update({ early_start_requested_at: m.early_start_requested_at })
      .in("id", bookingIds);
    if (earlyStartError) {
      console.error(`Could not record the early-start request on ${bookingIds.join(", ")}:`, earlyStartError);
    }
  }

  if (!regular) {
    await admin.from("booking_checkout_time_choices").delete().eq("checkout_session_id", session.id);
  }

  // A paid booking is confirmed as soon as the transaction above commits.
  // Provider matching is follow-up work and must never turn a saved booking into
  // a false checkout failure. The webhook or an operations retry can run it again.
  try {
    const preferred = m.preferred_provider_id;
    matched.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
    for (const bookingId of bookingIds) {
      const { error: queueError } = await admin.rpc("system_initialize_booking_offer_queue", {
        p_booking_id: bookingId,
        p_provider_ids: matched.map((provider) => provider.id),
      });
      if (queueError) throw queueError;
      await rotateBookingOffer(admin, bookingId);
    }
  } catch (matchingError) {
    console.error(`Bookings ${bookingIds.join(", ")} were saved, but provider matching needs a retry:`, matchingError);
  }

  return bookingIds[0];
}
