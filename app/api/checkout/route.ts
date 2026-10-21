import { currentCleaningBillingTerms } from "@/lib/cleaningBillingSettings";
import {
  validCheckoutLegalDocuments,
  checkoutLegalMatches,
} from "@/lib/checkoutLegal";
import { currentCheckoutLegal } from "@/lib/checkoutLegalServer";
import {
  DEFAULT_CLEANING_BILLING_TERMS,
  cleanerPayPence,
} from "@/lib/cleaningBillingTerms";
// Platform checkout. A completed visit is paid to its assigned cleaner later.
// Save at: app/api/checkout/route.ts
// Needs in .env.local: STRIPE_SECRET_KEY,
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

import { parseBookingPreferences } from "@/lib/bookingPreferences";
import { isCleaning, validCleaningDuration } from "@/lib/cleaningBooking";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  isStoredUkPhone,
  isValidUkPhone,
  normalizeUkPhone,
} from "@/lib/ukPhone";
import { startsWithinCancellationPeriod } from "@/lib/cancellationPeriod";
import {
  APPOINTMENT_WINDOW_MESSAGE,
  appointmentFitsWindow,
  appointmentWithinBookingHorizon,
  BOOKING_HORIZON_MESSAGE,
} from "@/lib/appointmentWindow";
import { normaliseOptionalBookingTimes } from "@/lib/bookingTimeChoices";
import { bookingPolicyError } from "@/lib/bookingPolicy";
import {
  REGULAR_MIN_VISITS,
  isRegularVisitCount,
  regularVisitSlots,
  type RegularFrequency,
} from "@/lib/regularBooking";
import { bookingNotesForHome, parseCleaningHome } from "@/lib/cleaningHome";
import { getOrCreateBillingCustomer } from "@/lib/accountBilling";
import { visitBillingEnabled } from "@/lib/visitBillingPolicy";
import { visitDiscounts, visitLineItems } from "@/lib/visitLineItems";

import {
  cleaningSeriesQuote,
  cleaningExtrasNotes,
  allocateCleaningPayments,
} from "@/lib/cleaningExtras";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Service role — for promo lookups and usage counts.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const {
      bookingPreferences,
      packageId,
      postcode,
      address,
      savedAddressId,
      frequency,
      request,
      home,
      slot,
      optionalSlots,
      promoCode,
      durationMinutes,
      preferredProviderId,
      phone,
      earlyStartRequested,
      regularVisits,
      addons,
      bringsProducts,
      petsAtHome,
      visitExtras,
      saveCardConsent,
      legalAccepted,
      legalDocuments,
    } = await req.json();
    if (legalAccepted !== true || !validCheckoutLegalDocuments(legalDocuments))
      return NextResponse.json(
        {
          error: "Read and accept the booking policies before paying.",
          code: "legal_consent_required",
        },
        { status: 400 },
      );
    let preferences;
    try {
      preferences = parseBookingPreferences(bookingPreferences);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid booking preferences.",
        },
        { status: 400 },
      );
    }
    const perVisit = visitBillingEnabled();
    if (perVisit && saveCardConsent !== true)
      return NextResponse.json(
        { error: "Confirm saving your card and the visit charging schedule." },
        { status: 400 },
      );
    if (
      process.env.VERCEL_ENV === "preview" &&
      (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ||
        new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname !==
          "comwdjprdedmsnxtvuuk.supabase.co")
    )
      return NextResponse.json(
        {
          error:
            "Staging payment isolation needs attention. No payment has been taken.",
        },
        { status: 503 },
      );
    if (!packageId) {
      return NextResponse.json({ error: "Missing packageId" }, { status: 400 });
    }

    // Get the REAL price from the database — never trust the browser for money.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
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
    const baseMinutes = cleaning
      ? Number(durationMinutes)
      : (pkg.duration_minutes ?? 120);
    if (cleaning && !validCleaningDuration(baseMinutes)) {
      return NextResponse.json(
        { error: "Choose 2–8 hours in 30-minute steps." },
        { status: 400 },
      );
    }
    const cleaningHome = parseCleaningHome(home);
    if (!cleaningHome) {
      return NextResponse.json(
        { error: "Add your property type, bedrooms and bathrooms." },
        { status: 400 },
      );
    }
    const enteredAddress = String(address ?? "").trim();
    if (enteredAddress.length < 5) {
      return NextResponse.json(
        { error: "Enter the full service address." },
        { status: 400 },
      );
    }
    const compactPostcode = String(postcode ?? "")
      .toUpperCase()
      .replace(/\s+/g, "");
    const addressHasPostcode = enteredAddress
      .toUpperCase()
      .replace(/\s+/g, "")
      .includes(compactPostcode);
    const serviceAddress = addressHasPostcode
      ? enteredAddress
      : `${enteredAddress}, ${String(postcode ?? "")
          .trim()
          .toUpperCase()}`;
    const bookingFrequency = String(frequency ?? "one_time");
    const policyError = bookingPolicyError(pkg.name, bookingFrequency);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }
    const regular = bookingFrequency !== "one_time";
    if (typeof petsAtHome !== "boolean")
      return NextResponse.json(
        { error: "Tell us whether you have pets at home." },
        { status: 400 },
      );
    const visitCount = regular
      ? Number(regularVisits ?? REGULAR_MIN_VISITS)
      : 1;
    if (regular && !isRegularVisitCount(visitCount))
      return NextResponse.json(
        { error: "Choose between six and ten visits." },
        { status: 400 },
      );
    const billingTerms = perVisit
      ? await currentCleaningBillingTerms(supabaseAdmin)
      : DEFAULT_CLEANING_BILLING_TERMS;
    let quote;
    try {
      quote = cleaningSeriesQuote(
        pkg,
        baseMinutes,
        addons,
        bringsProducts,
        visitCount,
        visitExtras,
        billingTerms,
      );
    } catch (cause) {
      return NextResponse.json(
        {
          error:
            cause instanceof Error ? cause.message : "Choose valid add-ons.",
        },
        { status: 400 },
      );
    }
    const minutes = quote.maxDurationMinutes;
    if (
      !slot ||
      !appointmentFitsWindow(slot, quote.quotes[0].durationMinutes)
    ) {
      return NextResponse.json(
        { error: APPOINTMENT_WINDOW_MESSAGE },
        { status: 400 },
      );
    }
    if (
      !appointmentWithinBookingHorizon(slot) ||
      new Date(slot).getTime() < Date.now() + 2 * 60 * 60 * 1000
    ) {
      return NextResponse.json(
        { error: BOOKING_HORIZON_MESSAGE },
        { status: 400 },
      );
    }

    let regularSlots: string[] = [];
    if (regular) {
      try {
        regularSlots = regularVisitSlots(
          slot,
          bookingFrequency as RegularFrequency,
          baseMinutes,
          Date.now(),
          visitCount,
        );
      } catch (cause) {
        return NextResponse.json(
          {
            error:
              cause instanceof Error
                ? cause.message
                : "Choose a valid regular schedule.",
          },
          { status: 400 },
        );
      }
      if (
        regularSlots.some(
          (value, index) =>
            !appointmentFitsWindow(value, quote.quotes[index].durationMinutes),
        )
      )
        return NextResponse.json(
          { error: APPOINTMENT_WINDOW_MESSAGE },
          { status: 400 },
        );
      if (Array.isArray(optionalSlots) && optionalSlots.length > 0) {
        return NextResponse.json(
          {
            error:
              "Optional times are only available for one-time visits. Your regular dates are shown before payment.",
          },
          { status: 400 },
        );
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

    const perVisitGross = quote.quotes[0].totalPence;
    const gross = quote.totalPence; // amount in pence

    // A service may only start inside the customer's 14-day cancellation period
    // at their express request, with their acknowledgement that the right to
    // cancel ends once it is fully performed (Consumer Contracts Regulations
    // 2013, reg. 36). Any of the chosen times could become the visit, so the
    // earliest one decides.
    const earliestStart = Math.min(
      new Date(slot).getTime(),
      ...alternativeTimes.map((time) => new Date(time).getTime()),
    );
    const startsInCancellationPeriod =
      startsWithinCancellationPeriod(earliestStart);
    if (startsInCancellationPeriod && earlyStartRequested !== true) {
      return NextResponse.json(
        {
          error:
            "Confirm that you want your service to start within your 14-day cancellation period.",
          code: "early_start_required",
        },
        { status: 400 },
      );
    }
    const earlyStartRequestedAt = startsInCancellationPeriod
      ? new Date().toISOString()
      : "";

    // Who's booking? Used to prefill their email on Stripe's checkout.
    const ssr = await createServerClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();

    if (!user)
      return NextResponse.json(
        { error: "Please sign in before checkout." },
        { status: 401 },
      );
    const { data: profile } = await ssr
      .from("profiles")
      .select("role, phone")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.role === "admin")
      return NextResponse.json(
        { error: "A client account is required." },
        { status: 403 },
      );

    const legalNow = await currentCheckoutLegal(supabaseAdmin);
    if (!checkoutLegalMatches(legalDocuments, legalNow.documents))
      return NextResponse.json(
        {
          error: "The booking policies have changed. Please review them again.",
          code: "legal_documents_changed",
        },
        { status: 409 },
      );
    const { data: legalConsentId, error: legalError } = await supabaseAdmin.rpc(
      "prepare_booking_legal_consent",
      {
        p_user: user.id,
        p_documents: legalDocuments,
        p_fallbacks: legalNow.fallbacks,
      },
    );
    if (legalError || !legalConsentId)
      return NextResponse.json(
        {
          error:
            "The booking policies have changed or are being updated. Please review them again before paying.",
          code: "legal_documents_changed",
        },
        { status: 409 },
      );

    // Legacy accounts must add a private phone number before checkout.
    // before a paid booking can be created.
    if (!isStoredUkPhone(profile.phone)) {
      if (!isValidUkPhone(phone)) {
        return NextResponse.json(
          {
            error:
              "Add your private UK phone number to complete your account. Your cleaner contacts you only through in-app messages.",
            code: "phone_required",
          },
          { status: 400 },
        );
      }
      const { error: phoneError } = await supabaseAdmin
        .from("profiles")
        .update({ phone: normalizeUkPhone(phone) })
        .eq("id", user.id);
      if (phoneError) {
        console.error("Could not save the customer's phone:", phoneError);
        return NextResponse.json(
          {
            error:
              "Could not save your phone number. No payment has been taken.",
          },
          { status: 500 },
        );
      }
    }

    // Never authorise a card unless this deployment can persist the booking.
    // The readiness function is installed by the booking database migration.
    const { data: bookingReady, error: bookingReadyError } =
      await supabaseAdmin.rpc("booking_checkout_ready");
    if (bookingReadyError || bookingReady !== true) {
      console.error("Booking checkout is not ready:", bookingReadyError);
      return NextResponse.json(
        {
          error:
            "Booking is temporarily unavailable while an update finishes. No payment has been taken.",
        },
        { status: 503 },
      );
    }
    const { data: extrasReady, error: extrasReadyError } =
      await supabaseAdmin.rpc("cleaning_extras_checkout_ready");
    if (extrasReadyError || extrasReady !== true)
      return NextResponse.json(
        {
          error:
            "Booking add-ons are being updated. No payment has been taken.",
        },
        { status: 503 },
      );
    if (perVisit) {
      const { data: ready, error } = await supabaseAdmin.rpc(
        "per_visit_checkout_ready",
      );
      if (error || ready !== true)
        return NextResponse.json(
          {
            error:
              "Visit payment scheduling is being updated. No payment has been taken.",
          },
          { status: 503 },
        );
    }
    if (regular) {
      const { data: regularReady, error: regularReadyError } =
        await supabaseAdmin.rpc("regular_checkout_ready");
      if (regularReadyError || regularReady !== true) {
        console.error("Regular checkout is not ready:", regularReadyError);
        return NextResponse.json(
          {
            error:
              "Regular booking is temporarily unavailable while an update finishes. No payment has been taken.",
          },
          { status: 503 },
        );
      }
    }

    if (preferredProviderId) {
      if (
        !cleaning ||
        typeof preferredProviderId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(preferredProviderId)
      ) {
        return NextResponse.json(
          { error: "Choose a previous cleaner from your booking history." },
          { status: 400 },
        );
      }
      const { data: past } = await supabaseAdmin
        .from("bookings")
        .select("id")
        .eq("customer_id", user.id)
        .eq("provider_id", preferredProviderId)
        .eq("status", "completed")
        .limit(1);
      const { data: favourite, error: favouriteError } = await supabaseAdmin
        .from("customer_favourite_providers")
        .select("provider_id")
        .eq("user_id", user.id)
        .eq("provider_id", preferredProviderId)
        .maybeSingle();
      if (favouriteError)
        return NextResponse.json(
          { error: "Could not check your favourite cleaner." },
          { status: 503 },
        );
      if (!past?.length && !favourite)
        return NextResponse.json(
          {
            error:
              "Choose a cleaner from your favourites or a completed visit.",
          },
          { status: 400 },
        );
    }
    let householdNotes = bookingNotesForHome(
      cleaningHome,
      String(request ?? ""),
    );
    if (savedAddressId) {
      if (
        typeof savedAddressId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(savedAddressId)
      )
        return NextResponse.json(
          { error: "Choose a valid saved address." },
          { status: 400 },
        );
      const { data: place, error: placeError } = await supabaseAdmin
        .from("customer_addresses")
        .select(
          "line1,line2,city,postcode,access_instructions,pets,products_provided_by",
        )
        .eq("user_id", user.id)
        .eq("id", savedAddressId)
        .maybeSingle();
      if (placeError || !place)
        return NextResponse.json(
          {
            error:
              "This saved address could not be loaded. Please select it again.",
          },
          { status: 400 },
        );
      const expectedAddress = [place.line1, place.line2, place.city]
        .filter(Boolean)
        .join(", ");
      if (
        expectedAddress !== enteredAddress ||
        place.postcode.replace(/\s/g, "").toUpperCase() !== compactPostcode
      ) {
        return NextResponse.json(
          {
            error:
              "The saved address changed. Please select it again or enter a new address.",
          },
          { status: 400 },
        );
      }
      householdNotes += [
        place.access_instructions && `Access: ${place.access_instructions}`,
      ]
        .filter(Boolean)
        .map((value) => `\n${value}`)
        .join("");
    }
    const compact = String(postcode ?? "")
      .toUpperCase()
      .replace(/\s+/g, "");
    const district = compact.length > 4 ? compact.slice(0, -3) : compact;
    const { data: areas } = await supabaseAdmin
      .from("service_areas")
      .select("postcode_prefixes")
      .eq("active", true);
    if (
      !district ||
      !(areas ?? []).some((area) =>
        (area.postcode_prefixes ?? []).includes(district),
      )
    ) {
      return NextResponse.json(
        { error: "This postcode is outside our service area." },
        { status: 400 },
      );
    }

    // Promotions never reduce the agreed pay for booked cleaning hours.
    // Legacy funded bookings retain their original allocations.
    const platformFeeFull = perVisit
      ? quote.quotes.reduce(
          (sum, visit) =>
            sum +
            Math.max(
              0,
              visit.basePence - cleanerPayPence(baseMinutes, billingTerms),
            ),
          0,
        )
      : allocateCleaningPayments(
          quote.quotes.map((visit) => visit.totalPence),
          0,
        ).reduce((sum, visit) => sum + visit.platformPence, 0);
    const providerAmount = perVisit ? 0 : gross - platformFeeFull;

    // ---- Promo code (validated server-side; discount comes out of margin) ----
    let discount = 0;
    let appliedCode: string | null = null;
    if (promoCode) {
      const clean = String(promoCode).trim().toUpperCase();
      const { data: promo } = await supabaseAdmin
        .from("promo_codes")
        .select(
          "code, percent_off, amount_off, active, expires_at, max_uses, uses",
        )
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

    const discounts = visitDiscounts(
      quote.quotes.map((visit) => visit.totalPence),
      discount,
    );
    const chargeAmount = perVisit
      ? quote.quotes[0].totalPence - discounts[0]
      : gross - discount;
    const platformFee = perVisit ? 0 : platformFeeFull - discount;

    if (platformFee >= gross) {
      return NextResponse.json(
        { error: "Split misconfigured" },
        { status: 500 },
      );
    }

    const billingCustomer = await getOrCreateBillingCustomer(stripe, {
      id: user.id,
      email: user.email,
    });
    const bookingMetadata = {
      kind: "booking",
      billing_model: perVisit ? "per_visit" : "legacy",
      upfront_regular: regular ? "1" : "0",
      regular_visit_count: String(visitCount),
      customer_id: user.id,
      legal_consent_id: String(legalConsentId),
      duration_minutes: String(minutes),
      base_duration_minutes: String(baseMinutes),
      cleaning_extras_version: "1",
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
    };
    const saveRegularCard = perVisit && regular;
    const session = await stripe.checkout.sessions.create({
      mode: saveRegularCard ? "setup" : "payment",
      metadata: bookingMetadata,
      payment_method_types: ["card"],
      ...(saveRegularCard
        ? { currency: "gbp", setup_intent_data: { metadata: bookingMetadata } }
        : {
            ...(regular || perVisit
              ? { payment_method_types: ["card"] as ["card"] }
              : {}),

            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: "gbp",
                  unit_amount: chargeAmount,
                  product_data: {
                    name: `${pkg.name} — ${regular ? (perVisit ? "first visit · " : `${visitCount} visits × `) : ""}${quote.quotes[0].durationMinutes / 60} hours${
                      appliedCode ? ` (${appliedCode} applied)` : ""
                    }`,
                  },
                },
              },
            ],
            payment_intent_data: {
              // New one-off visits are charged at booking. Funds stay on the platform
              // until the completed visit can pay its assigned cleaner.
              capture_method: perVisit || regular ? "automatic" : "manual",
              ...(perVisit
                ? { setup_future_usage: "off_session" as const }
                : {}),
              transfer_group: regular
                ? `ob_regular_${crypto.randomUUID()}`
                : `ob_booking_${crypto.randomUUID()}`,
              metadata: bookingMetadata,
            },
          }),
      client_reference_id: user.id,
      customer: billingCustomer,
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
        legal_consent_id: legalConsentId,
        legal_consent_required: true,
        customer_id: user.id,
        preferred_scheduled_at: slot,
        optional_scheduled_at: alternativeTimes,
        household_notes: householdNotes,
        booking_preferences: preferences,
        cleaning_extras: quote.quotes.map((visit, index) => ({
          baseMinutes,
          addons: visit.addons.map((item) => item.id),
          bringsProducts: visit.bringsProducts,
          petsAtHome,
          durationMinutes: visit.durationMinutes,
          basePricePence: visit.basePence,
          grossPence: visit.totalPence,
          ...(perVisit
            ? {
                netPence: visit.totalPence - discounts[index],
                discountPence: discounts[index],
                lineItems: visitLineItems(visit, discounts[index]),
                billingModel: "per_visit",
                payRatePending: false,
                billingSettings: billingTerms,
                chargeTiming: regular ? "acceptance" : "checkout_then_48h",
                cardConsentAt: new Date().toISOString(),
                cardConsentVersion: "visit-billing-v1",
              }
            : {}),
          notes: cleaningExtrasNotes(
            visit.addons.map((item) => item.id),
            visit.bringsProducts,
            petsAtHome,
            billingTerms,
          ),
        })),
        ...(regular ? { regular_scheduled_at: regularSlots } : {}),
      });
    if (timeChoicesError) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      console.error("Could not stage booking time choices:", timeChoicesError);
      return NextResponse.json(
        {
          error: "Could not save your time choices. No payment has been taken.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg =
      e instanceof Stripe.errors.StripeError
        ? "Secure checkout is temporarily unavailable. No booking has been confirmed."
        : e instanceof Error
          ? e.message
          : "Checkout failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
