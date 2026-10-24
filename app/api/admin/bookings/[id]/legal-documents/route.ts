import { createClient } from "@/lib/supabase/server";
import { GET as download } from "@/app/api/bookings/[id]/legal-documents/route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const client = await createClient();
  const allowed = await client.rpc("is_admin");
  if (allowed.error || allowed.data !== true)
    return Response.json(
      { error: "Staff authenticator sign-in required" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  return download(request, context);
}
