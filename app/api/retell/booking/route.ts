import { NextRequest, NextResponse } from "next/server";
import { assistantServices, assistantSlots, prepareAssistantBooking } from "@/lib/assistantBookingServer";
import { normaliseAssistantPostcode } from "@/lib/assistantBooking";
import { verifiedRetellRequest } from "@/lib/retellRequest";
import { VoiceBookingError } from "@/lib/voiceBooking";
import { createVoiceRequest, voiceBookingAdmin, voiceRequestStatus } from "@/lib/voiceBookingServer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const request = await verifiedRetellRequest(await req.text(), req.headers.get("x-retell-signature"), process.env.RETELL_API_KEY, process.env.RETELL_BOOKING_AGENT_ID);
    const db = voiceBookingAdmin();
    const { args, name, agentId, callId } = request;
    let result: unknown;
    if (name === "get_cleaning_services") {
      result = { services: await assistantServices(db), now: new Date().toISOString(), time_zone: "Europe/London" };
    } else if (name === "check_booking_options") {
      const date = String(args.date ?? "");
      const time = args.preferred_time == null ? "" : String(args.preferred_time);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new VoiceBookingError("Confirm the requested London calendar date in YYYY-MM-DD format.");
      if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new VoiceBookingError("Confirm the preferred London time in HH:mm format.");
      const choices = await assistantSlots(db, normaliseAssistantPostcode(args.postcode), Number(args.duration_minutes), date);
      const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      const ordered = time ? choices.slots.filter((slot) => fmt.format(new Date(slot)) >= time) : choices.slots;
      const selected = ordered.slice(0, 6);
      result = {
        covered: choices.covered, area: choices.area, count: choices.count,
        slots: selected.map((slot) => ({ slot, london_time: fmt.format(new Date(slot)) })),
        quote: selected.length ? await prepareAssistantBooking(db, { ...args, slot: selected[0] }) : null,
        time_zone: "Europe/London", now: new Date().toISOString(),
        note: "These are permitted booking times, not a cleaner availability guarantee or a reservation. A cleaner is matched after checkout. Ask for another time/date if no options are returned. Quote is for the first returned time; creating a request revalidates it.",
      };
    } else if (name === "create_voice_booking") {
      result = await createVoiceRequest(db, agentId, callId, args);
    } else if (name === "get_voice_booking_status") {
      result = await voiceRequestStatus(db, agentId, callId, args.request_id);
    } else throw new VoiceBookingError("Unknown booking function.");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof VoiceBookingError)) console.error("Voice booking action failed.");
    return NextResponse.json({ error: error instanceof VoiceBookingError ? error.message : "Could not complete this booking action. Do not confirm a booking; try again or contact support." }, { status: error instanceof VoiceBookingError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
