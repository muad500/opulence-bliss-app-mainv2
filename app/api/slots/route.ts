// Available slots for a postcode.
// Save at: app/api/slots/route.ts
// Try: localhost:3000/api/slots?postcode=SW3%201AA

import { isCleaning, validCleaningDuration } from "@/lib/cleaningBooking";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  londonParts,
} from "@/lib/appointmentWindow";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

import { permittedAppointmentSlots } from "@/lib/appointmentSlots";

function outwardCode(pc: string) {
  const s = (pc || "").toUpperCase().replace(/\s+/g, "");
  if (s.length <= 4) return s;
  return s.slice(0, s.length - 3);
}

export async function GET(req: NextRequest) {
  try {
    const postcode = req.nextUrl.searchParams.get("postcode") ?? "";
    const requestedDuration = Number(
      req.nextUrl.searchParams.get("duration") ??
        DEFAULT_APPOINTMENT_DURATION_MINUTES,
    );
    if (!isCleaning(req.nextUrl.searchParams.get("service"))) {
      return NextResponse.json(
        { error: "Home cleaning is the available booking service." },
        { status: 400 },
      );
    }
    const durationMinutes =
      Number.isFinite(requestedDuration) && requestedDuration > 0
        ? Math.min(Math.round(requestedDuration), 12 * 60)
        : DEFAULT_APPOINTMENT_DURATION_MINUTES;
    if (isCleaning(req.nextUrl.searchParams.get("service")) && !validCleaningDuration(requestedDuration)) {
      return NextResponse.json({ error: "Cleaning sessions must be 2–8 hours in 30-minute steps." }, { status: 400 });
    }
    const out = outwardCode(postcode);
    if (!out) {
      return NextResponse.json({ error: "Missing postcode" }, { status: 400 });
    }

    // 1. Which areas cover this postcode?
    const { data: areas } = await admin
      .from("service_areas")
      .select("id, name, postcode_prefixes")
      .eq("active", true);

    const areaIds = (areas ?? [])
      .filter((a) => (a.postcode_prefixes ?? []).includes(out))
      .map((a) => a.id);

    if (areaIds.length === 0) {
      return NextResponse.json({ covered: false, slots: [], suggested: [] });
    }

    // Customers choose the appointment first. Provider availability does not
    // remove a permitted time: matching and offer rotation happen after the
    // booking is paid. This keeps the customer flow open even with a thin
    // worker roster.
    const { slots, horizon } = permittedAppointmentSlots(durationMinutes);

    // Suggested times are convenience choices, never availability claims.
    const suggested: { iso: string; reason: string }[] = [];
    const push = (iso: string, reason: string) => {
      if (iso && !suggested.some((s) => s.iso === iso) && suggested.length < 3) {
        suggested.push({ iso, reason });
      }
    };

    if (slots.length) {
      push(slots[0], "Soonest permitted time");
      const morning = slots.find((slot) => {
        const d = londonParts(slot);
        return d.weekday >= 1 && d.weekday <= 5 && d.hour >= 9 && d.hour <= 11;
      });
      if (morning) push(morning, "Weekday morning");
    }

    return NextResponse.json({
      covered: true,
      slots,
      suggested,
      appointmentWindow: {
        start: "07:00",
        end: "20:00",
        durationMinutes,
        bookingHorizon: horizon.toISOString(),
      },
      workerAvailabilityRequired: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load slots";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
