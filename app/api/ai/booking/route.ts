import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  assistantServices,
  assistantSlots,
  prepareAssistantBooking,
} from "@/lib/assistantBookingServer";
import { normaliseAssistantPostcode } from "@/lib/assistantBooking";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  try {
    const pc = req.nextUrl.searchParams.get("postcode");
    const data = pc
      ? await assistantSlots(
          db,
          normaliseAssistantPostcode(pc),
          Number(req.nextUrl.searchParams.get("duration") ?? 120),
        )
      : { services: await assistantServices(db) };
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load booking choices.",
      },
      { status: 400 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await prepareAssistantBooking(db, await req.json());
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare this booking.",
      },
      { status: 400 },
    );
  }
}
