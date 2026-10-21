import { createClient } from "@/lib/supabase/server";
import { validCheckoutLegalDocuments } from "@/lib/checkoutLegal";
import { currentCheckoutLegal } from "@/lib/checkoutLegalServer";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const client = await createClient();
    const ready = await client.rpc("checkout_legal_consent_ready");
    const { documents } = await currentCheckoutLegal(client);
    if (
      ready.error ||
      ready.data !== true ||
      !validCheckoutLegalDocuments(documents)
    )
      throw new Error("Unavailable");
    return Response.json({ documents }, { headers });
  } catch {
    return Response.json(
      {
        error: "Booking policies are being updated. Please try again shortly.",
      },
      { status: 503, headers },
    );
  }
}
