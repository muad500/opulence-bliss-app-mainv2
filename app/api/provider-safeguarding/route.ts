import { createClient } from "@/lib/supabase/server";
import { safeguardingRegistration } from "@/lib/safeguardingRegistration";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const client = await createClient();
    const config = await safeguardingRegistration(client);
    return Response.json(
      {
        ...config,
        href: config.enabled ? "/legal/safeguarding" : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "The safeguarding policy could not be loaded." },
      { status: 503 },
    );
  }
}
