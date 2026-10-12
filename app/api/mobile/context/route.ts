import { createClient } from "@/lib/supabase/server";
import { canUseProfessionalTools } from "@/lib/professionalAccess";
export async function GET() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return Response.json(
      { signedIn: false, registered: false, canWork: false },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  const { data: provider } = await client
    .from("providers")
    .select("id,vetting_status,is_suspended,service_approvals")
    .eq("profile_id", user.id)
    .maybeSingle();
  return Response.json(
    {
      signedIn: true,
      registered: !!provider,
      canWork: canUseProfessionalTools(provider),
    },
    { headers: { "Cache-Control": "private,no-store" } },
  );
}
