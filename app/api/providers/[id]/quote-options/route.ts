import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Professional not found." }, { status: 404 });
  const supabase = await createClient();
  const { data: eligible, error } = await supabase.rpc("public_eligible_provider_ids").eq("id", id);
  if (error || !eligible?.length) return NextResponse.json({ error: "This professional is not currently available for quotes." }, { status: 404 });
  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const [provider, rates] = await Promise.all([
    admin.from("providers").select("display_name,services").eq("id", id).single(),
    admin.from("provider_task_rates").select("task_name,hourly_rate_pence").eq("provider_id", id).order("task_name"),
  ]);
  if (provider.error || rates.error) return NextResponse.json({ error: "Rates could not be loaded." }, { status: 503 });
  if (!provider.data.services?.includes("handyman")) return NextResponse.json({ error: "This professional does not offer handyman work." }, { status: 404 });
  return NextResponse.json({ id, displayName: provider.data.display_name, rates: rates.data }, { headers: { "Cache-Control": "private, no-store" } });
}
