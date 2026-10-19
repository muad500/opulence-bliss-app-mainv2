import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HandymanPostJob from "@/components/HandymanPostJob";
export default async function PropertyMaintenanceBooking() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login?next=/handyman");
  return <HandymanPostJob />;
}
