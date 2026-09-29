// Stripe Connect checkout — creates a payment that auto-splits.
// Save at: app/api/checkout/route.ts
// Needs in .env.local: STRIPE_SECRET_KEY, PROVIDER_TEST_ACCOUNT,
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

import { bookingPricePence, isCleaning, validCleaningDuration } from "@/lib/cleaningBooking";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isStoredUkPhone, isValidUkPhone, normalizeUkPhone } from "@/lib/ukPhone";
import { startsWithinCancellationPeriod } from "@/lib/cancellationPeriod";
import {
  APPOINTMENT_WINDOW_MESSAGE,
  appointmentFitsWindow,
  appointmentWithinBookingHorizon,
  BOOKING_HORIZON_MESSAGE,
} from "@/lib/appointmentWindow";
import { normaliseOptionalBookingTimes } from "@/lib/bookingTimeChoices";
import { bookingPolicyError } from "@/lib/bookingPolicy";
import { REGULAR_MIN_VISITS, isRegularVisitCount, regularVisitSlots, type RegularFrequency } from "@/lib/regularBooking";
import { bookingNotesForHome, parseCleaningHome } from "@/lib/cleaningHome";
import { getOrCreateBillingCustomer } from "@/lib/accountBilling";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Service role — for promo lookups and usage counts.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { packageId, postcode, address, frequency, request, home, slot, optionalSlots, promoCode, durationMinutes, preferredProviderId, phone, earlyStartRequested, regularVisits } = await req.json();
    if (!packageId) {
      return NextResponse.json({ error: "Missing packageId" }, { status: 400 });
    }

    // Get the REAL price from the database — never trust the browser for money.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
    );
    const { data: pkg, error } = await supabase
      .from("packages")
      .select("name, price, duration_minutes, service_type")
      .eq("id", packageId)
      .eq("active", true)
      .eq("billing_type", "per_visit")
      .single();

    if (error || !pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    const cleaning = isCleaning(pkg.service_type);
    if (!cleaning) {
      return NextResponse.json(
        { error: "That service is no longer available." },
        { status: 400 },
      );
    }
    const minutes = cleaning ? Number(durationMinutes) : pkg.duration_minutes ?? 120;
    if (cleaning && !validCleaningDuration(minutes)) {
      return NextResponse.json({ error: "Choose 2–8 hours in 30-minute steps." }, { status: 400 });
    }
    const cleaningHome = parseCleaningHome(home);
    if (!cleaningHome) {
      return NextResponse.json({ error: "Add your property type, bedrooms and bathrooms." }, { status: 400 });
    }
    const enteredAddress = String(address ?? "").trim();
    if (enteredAddress.length < 5) {
      return NextResponse.json({ error: "Enter the full service address." }, { status: 400 });
    }
    const compactPostcode = String(postcode ?? "").toUpperCase().replace(/\s+/g, "");
    const addressHasPostcode = enteredAddress.toUpperCase().replace(/\s+/g, "").includes(compactPostcode);
    const serviceAddress = addressHasPostcode
      ? enteredAddress
      : `${enteredAddress}, ${String(postcode ?? "").trim().toUpperCase()}`;
    const bookingFrequency = String(frequency ?? "one_time");
    const policyError = bookingPolicyError(pkg.name, bookingFrequency);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }
    const regular = bookingFrequency !== "one_time";
    if (!slot || !appointmentFitsWindow(slot, minutes)) {
      return NextResponse.json(
        { error: APPOINTMENT_WINDOW_MESSAGE },
        { status: 400 },
      );
    }
    if (!appointmentWithinBookingHorizon(slot) || new Date(slot).getTime() < Date.now() + 2 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: BOOKING_HORIZON_MESSAGE },
        { status: 400 },
      );
    }
    const visitCount = regular ? Number(regularVisits ?? REGULAR_MIN_VISITS) : 1;
    if (regular && !isRegularVisitCount(visitCount)) {
      return NextResponse.json({ error: "Choose between six and ten visits." }, { status: 400 });
    }
    let regularSlots: string[] = [];
    if (regular) {
      try {
        regularSlots = regularVisitSlots(slot, bookingFrequency as RegularFrequency, minutes, Date.now(), visitCount);
      } catch (cause) {
        return NextResponse.json({ error: cause instanceof Error ? cause.message : "Choose a valid regular schedule." }, { status: 400 });
      }
      if (Array.isArray(optionalSlots) && optionalSlots.length > 0) {
        return NextResponse.json({ error: "Optional times are only available for one-time visits. Your regular dates are shown before payment." }, { status: 400 });
      }
    }
    let alternativeTimes: string[];
    try {
      alternativeTimes = normaliseOptionalBookingTimes(
        optionalSlots,
        slot,
        minutes,
      );
    } catch (optionalTimeError) {
      return NextResponse.json(
        {
          error:
            optionalTimeError instanceof Error
              ? optionalTimeError.message
              : "Choose valid optional times.",
        },
        { status: 400 },
      );
    }
    if (
      alternativeTimes.some(
        (alternative) =>
          new Date(alternative).getTime() < Date.now() + 2 * 60 * 60 * 1000,
      )
    ) {
      return NextResponse.json(
        { error: BOOKING_HORIZON_MESSAGE },
        { status: 400 },
      );
    }

    const perVisitGross = bookingPricePence(pkg, minutes);
    const gross = perVisitGross * visitCount; // amount in pence

    // A service may only start inside the customer's 14-day cancellation period
    // at their express request, with their acknowledgement that the right to
    // cancel ends once it is fully performed (Consumer Contracts Regulations
    // 2013, reg. 36). Any of the chosen times could become the visit, so the
    // earliest one decides.
    const earliestStart = Math.min(
      new Date(slot).getTime(),
      ...alternativeTimes.map((time) => new Date(time).getTime()),
    );
    const startsInCancellationPeriod = startsWithinCancellationPeriod(earliestStart);
    if (startsInCancellationPeriod && earlyStartRequested !== true) {
      return NextResponse.json(
        {
          error: "Confirm that you want your service to start within your 14-day cancellation period.",
          code: "early_start_required",
        },
        { status: 400 },
      );
    }
    const earlyStartRequestedAt = startsInCancellationPeriod ? new Date().toISOString() : "";

    // Who's booking? Used to prefill their email on Stripe's checkout.
    const ssr = await createServerClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();

    if (!user) return NextResponse.json({ error: "Please sign in before checkout." }, { status: 401 });
    const { data: profile } = await ssr.from("profiles").select("role, phone").eq("id", user.id).maybeSingle();
    if (!profile || profile.role === "admin") return NextResponse.json({ error: "A client account is required." }, { status: 403 });

    // Sign-up does not require a phone, but the assigned cleaner needs one
    // before a paid booking can be created.
    if (!isStoredUkPhone(profile.phone)) {
      if (!isValidUkPhone(phone)) {
        return NextResponse.json(
          { error: "Add a UK phone number so your cleaner can reach you on the day.", code: "phone_required" },
          { status: 400 },
        );
      }
      const { error: phoneError } = await supabaseAdmin
        .from("profiles")
        .update({ phone: normalizeUkPhone(phone) })
        .eq("id", user.id);
      if (phoneError) {
        console.error("Could not save the customer's phone:", phoneError);
        return NextResponse.json({ error: "Could not save your phone number. No payment has been taken." }, { status: 500 });
      }
    }

    // Never authorise a card unless this deployment can persist the booking.
    // The readiness function is installed by the booking database migration.
    const { data: bookingReady, error: bookingReadyError } = await supabaseAdmin.rpc("booking_checkout_ready");
    if (bookingReadyError || bookingReady !== true) {
      console.error("Booking checkout is not ready:", bookingReadyError);
      return NextResponse.json(
        { error: "Booking is temporarily unavailable while an update finishes. No payment has been taken." },
        { status: 503 },
      );
    }
    if (regular) {
      const { data: regularReady, error: regularReadyError } = await supabaseAdmin.rpc("regular_checkout_ready");
      if (regularReadyError || regularReady !== true) {
        console.error("Regular checkout is not ready:", regularReadyError);
        return NextResponse.json(
          { error: "Regular booking is temporarily unavailable while an update finishes. No payment has been taken." },
          { status: 503 },
        );
      }
    }

    if (preferredProviderId) {
      if (!cleaning || typeof preferredProviderId !== "string" || !/^[0-9a-f-]{36}$/i.test(preferredProviderId)) {
        return NextResponse.json({ error: "Choose a previous cleaner from your booking history." }, { status: 400 });
      }
      const { data: past } = await supabaseAdmin.from("bookings").select("id").eq("customer_id", user.id)
        .eq("provider_id", preferredProviderId).eq("status", "completed").limit(1);
      if (!past?.length) return NextResponse.json({ error: "You can only request a cleaner from a completed visit." }, { status: 400 });
    }
    const compact = String(postcode ?? "").toUpperCase().replace(/\s+/g, "");
    const district = compact.length > 4 ? compact.slice(0, -3) : compact;
    const { data: areas } = await supabaseAdmin.from("service_areas").select("postcode_prefixes").eq("active", true);
    if (!district || !(areas ?? []).some((area) => (area.postcode_prefixes ?? []).includes(district))) {
      return NextResponse.json({ error: "This postcode is outside our service area." }, { status: 400 });
    }

    // ---- PLACEHOLDER split — REPLACE with the client's SIGNED numbers ----
    // Per-visit model: the platform takes a margin, the provider keeps the rest.
    // Per-visit booking only. Professional onboarding has no joining fee.
    const PLATFORM_MARGIN_RATE = 0.2; // 20% platform margin
    // ---------------------------------------------------------------------
    const platformFeeFull = Math.round(gross * PLATFORM_MARGIN_RATE);
    const providerAmount = gross - platformFeeFull; // auto-sent to the provider

    // ---- Promo code (validated server-side; discount comes out of margin) ----
    let discount = 0;
    let appliedCode: string | null = null;
    if (promoCode) {
      const clean = String(promoCode).trim().toUpperCase();
      const { data: promo } = await supabaseAdmin
        .from("promo_codes")
        .select("code, percent_off, amount_off, active, expires_at, max_uses, uses")
        .eq("code", clean)
        .maybeSingle();

      const usable =
        promo &&
        promo.active &&
        (!promo.expires_at || new Date(promo.expires_at) >= new Date()) &&
        (promo.max_uses === null || promo.uses < promo.max_uses);

      if (usable) {
        const raw = promo!.percent_off
          ? Math.round((gross * promo!.percent_off) / 100)
          : Math.round(Number(promo!.amount_off ?? 0) * 100);
        discount = Math.max(0, Math.min(raw, platformFeeFull));
        if (discount > 0) {
          appliedCode = promo!.code;
          await supabaseAdmin
            .from("promo_codes")
            .update({ uses: (promo!.uses ?? 0) + 1 })
            .eq("code", promo!.code);
        }
      }
    }

    const chargeAmount = gross - discount;
    const platformFee = platformFeeFull - discount;

    if (platformFee >= gross) {
      return NextResponse.json({ error: "Split misconfigured" }, { status: 500 });
    }

    const billingCustomer = await getOrCreateBillingCustomer(stripe, { id: user.id, email: user.email });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(regular ? { payment_method_types: ["card"] as ["card"] } : {}),
      client_reference_id: user.id,
      customer: billingCustomer,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: chargeAmount,
            product_data: {
              name: `${pkg.name} — ${regular ? `${visitCount} visits × ` : ""}${minutes / 60} hours${
                appliedCode ? ` (${appliedCode} applied)` : ""
              }`,
            },
          },
        },
      ],
      payment_intent_data: {
        // A regular series is charged upfront to the platform. Each cleaner
        // receives a separate transfer only after their own visit is complete.
        capture_method: regular ? "automatic" : "manual",
        ...(regular
          ? { transfer_group: `ob_regular_${crypto.randomUUID()}` }
          : { application_fee_amount: platformFee, transfer_data: { destination: process.env.PROVIDER_TEST_ACCOUNT! } }),
        metadata: {
          kind: "booking",
          upfront_regular: regular ? "1" : "0",
          regular_visit_count: String(visitCount),
          customer_id: user.id,
          duration_minutes: String(minutes),
          service_address: serviceAddress.slice(0, 480),
          booking_frequency: bookingFrequency,
          preferred_provider_id: preferredProviderId || "",
          package: pkg.name,
          package_id: packageId,
          postcode: postcode ?? "",
          request: bookingNotesForHome(cleaningHome, String(request ?? "")),
          slot: slot ?? "",
          provider_amount: String(providerAmount),
          platform_margin: String(platformFee),
          per_visit_gross: String(perVisitGross),
          promo_code: appliedCode ?? "",
          discount: String(discount),
          // Evidence of the customer's express request, kept with the payment.
          early_start_requested_at: earlyStartRequestedAt,
        },
      },
      success_url: `${req.nextUrl.origin}/api/book/finalize?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.nextUrl.origin}/book?canceled=1`,
    });

    // Stripe metadata is intentionally small and cannot safely carry every
    // time a customer may select. Stage the complete list by checkout ID and
    // consume it only after Stripe confirms the payment authorisation.
    const { error: timeChoicesError } = await supabaseAdmin
      .from("booking_checkout_time_choices")
      .upsert({
        checkout_session_id: session.id,
        customer_id: user.id,
        preferred_scheduled_at: slot,
        optional_scheduled_at: alternativeTimes,
        ...(regular ? { regular_scheduled_at: regularSlots } : {}),
      });
    if (timeChoicesError) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      console.error("Could not stage booking time choices:", timeChoicesError);
      return NextResponse.json(
        { error: "Could not save your time choices. No payment has been taken." },
        { status: 503 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
