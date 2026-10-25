import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingLegalContract } from "./bookingLegalEvidence";
import {
  generateBookingLegalPdf,
  generateCancellationFormPdf,
} from "./bookingLegalPdf";

export const checkoutPolicyHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export function policyCopyId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function loadCheckoutPolicyCopy(
  admin: SupabaseClient,
  id: string,
  ownerId?: string,
) {
  let query = admin
    .from("booking_checkout_legal_consents")
    .select("id,user_id,accepted_at,documents,evidence")
    .eq("id", id);
  if (ownerId) query = query.eq("user_id", ownerId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Checkout policy copies are unavailable");
  if (!data?.evidence || !Array.isArray(data.documents)) return null;
  const slugs = data.documents.map((doc) => doc?.slug);
  if (
    slugs.length !== 3 ||
    !["terms", "cancellation-refund", "privacy"].every(
      (slug) => slugs.filter((value) => value === slug).length === 1,
    ) ||
    data.evidence.account?.userId !== data.user_id ||
    !data.evidence.account?.email ||
    !Number.isFinite(Date.parse(data.accepted_at))
  )
    return null;
  return {
    id: data.id,
    acceptedAt: data.accepted_at,
    documents: data.documents,
    evidence: data.evidence,
    // A checkout policy copy does not create or assert a completed booking.
    bookings: [],
  } as BookingLegalContract;
}

export async function checkoutPolicyDownload(
  request: Request,
  contract: BookingLegalContract,
) {
  try {
    const form =
      new URL(request.url).searchParams.get("form") === "cancellation";
    const bytes = form
      ? await generateCancellationFormPdf(contract.acceptedAt)
      : await generateBookingLegalPdf(contract, { checkoutOnly: true });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...checkoutPolicyHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${form ? "cancellation-form" : "checkout-policies"}-${contract.id.slice(0, 8)}.pdf"`,
      },
    });
  } catch {
    return Response.json(
      { error: "Could not generate the saved checkout policies" },
      { status: 503, headers: checkoutPolicyHeaders },
    );
  }
}
