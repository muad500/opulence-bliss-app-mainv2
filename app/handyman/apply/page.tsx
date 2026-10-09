import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export default async function HandymanApplicationRedirect() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  const { data: provider } = user
    ? await client
        .from("providers")
        .select("id")
        .eq("profile_id", user.id)
        .maybeSingle()
    : { data: null };
  redirect(
    provider
      ? "/worker/profile?addService=handyman#services"
      : "/provider/join?service=handyman",
  );
}
