import PortalLiveSync from "@/components/PortalLiveSync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { professionalPortal } from "@/lib/professionalPortal";
import { appEntry } from "@/lib/mobileExperience";
export default async function Inbox({
  params,
}: {
  params: Promise<{ audience: string }>;
}) {
  const { audience } = await params;
  if (audience !== "customer" && audience !== "worker") notFound();
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    return (
      <main style={{ padding: 24 }}>
        <h1>Your inbox</h1>
        <p>Sign in to see messages about your visits.</p>
        <Link
          href={`${audience === "worker" ? "/provider/login" : "/login"}?next=${encodeURIComponent(appEntry(audience, "inbox"))}`}
        >
          Sign in
        </Link>
      </main>
    );
  const provider =
    audience === "worker" ? (await professionalPortal()).provider : null;
  const { data: bookings, error } = await client
    .from("bookings")
    .select("id,scheduled_at,status,packages(name)")
    .eq(
      audience === "customer" ? "customer_id" : "provider_id",
      provider?.id ?? user.id,
    )
    .in("status", ["scheduled", "in_progress", "completed"])
    .order("scheduled_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Your conversations could not be loaded.");
  return (
    <main style={{ padding: 20 }}>
      <PortalLiveSync userId={user.id} />
      <h1 style={{ fontSize: 26 }}>Your inbox</h1>
      <p style={{ color: "var(--ob-muted)", fontSize: 14 }}>
        Choose a visit to open its messages.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {!bookings?.length && (
          <p>
            No conversations yet. Messages appear here when a visit is
            confirmed.
          </p>
        )}
        {bookings?.map((booking) => (
          <Link
            key={booking.id}
            href={`${audience === "customer" ? "/account/visit/" : "/worker/job/"}${booking.id}#messages`}
            style={{
              display: "grid",
              gap: 6,
              padding: 18,
              border: "1px solid var(--ob-border)",
              borderRadius: 18,
              background: "var(--ob-surface)",
              color: "var(--ob-text)",
              textDecoration: "none",
            }}
          >
            <strong>Cleaning visit</strong>
            <span style={{ color: "var(--ob-muted)", fontSize: 13 }}>
              {new Date(booking.scheduled_at).toLocaleDateString("en-GB", {
                timeZone: "Europe/London",
                day: "numeric",
                month: "short",
              })}{" "}
              · {booking.status.replaceAll("_", " ")}
            </span>
            <small style={{ color: "var(--ob-purple)" }}>Open messages →</small>
          </Link>
        ))}
      </div>
    </main>
  );
}
