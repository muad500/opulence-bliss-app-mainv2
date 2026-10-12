import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PortalLiveSync from "@/components/PortalLiveSync";
import MobileAppHome from "@/components/MobileAppHome";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ audience: string }>;
  searchParams: Promise<{ screen?: string }>;
}) {
  const { audience } = await params;
  if (audience !== "customer" && audience !== "worker") notFound();
  const { screen } = await searchParams;
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  const { data: profile } = user
    ? await client
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const { data: visits } =
    user && audience === "customer"
      ? await client
          .from("bookings")
          .select("id,scheduled_at,status")
          .eq("customer_id", user.id)
          .in("status", ["scheduled", "in_progress"])
          .order("scheduled_at")
          .limit(1)
      : { data: [] };
  const visit = visits?.[0];
  return (
    <>
      {user && <PortalLiveSync userId={user.id} />}
      <MobileAppHome
        audience={audience}
        screen={screen ?? null}
        name={profile?.full_name?.split(" ")[0] ?? ""}
        signedIn={!!user}
        nextVisit={
          visit
            ? {
                id: visit.id,
                scheduledAt: visit.scheduled_at,
                status: visit.status,
              }
            : null
        }
      />
    </>
  );
}
