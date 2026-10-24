import { createClient } from "@/lib/supabase/server";
import {
  generateBookingLegalPdf,
  generateCancellationFormPdf,
} from "@/lib/bookingLegalPdf";
import type { BookingLegalContract } from "@/lib/bookingLegalEvidence";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return Response.json(
      { error: "Booking not found" },
      { status: 404, headers },
    );
  const client = await createClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user)
    return Response.json({ error: "Sign in first" }, { status: 401, headers });
  const { data, error } = await client.rpc("booking_legal_contract", {
    p_booking: id,
  });
  if (error)
    return Response.json(
      { error: "Booking policies are temporarily unavailable" },
      { status: 503, headers },
    );
  if (!data)
    return Response.json(
      { error: "No saved policy copy for this booking" },
      { status: 404, headers },
    );
  const contract = data as BookingLegalContract;
  try {
    const form =
      new URL(request.url).searchParams.get("form") === "cancellation";
    const bytes = form
      ? await generateCancellationFormPdf(contract.acceptedAt)
      : await generateBookingLegalPdf(contract);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${form ? "cancellation-form" : "booking-policies"}-${id.slice(0, 8)}.pdf"`,
      },
    });
  } catch {
    return Response.json(
      { error: "Could not generate your saved policies" },
      { status: 503, headers },
    );
  }
}
