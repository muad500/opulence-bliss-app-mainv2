import Link from "next/link";
import AdminNav from "../AdminNav";
import { requireAdminPage } from "@/lib/adminSession";
import { reviewChatFlag } from "./actions";

type Flag = {
  id: number;
  booking_id: string;
  sender_id: string;
  sender_role: "customer" | "provider" | "admin";
  attempted_text: string;
  category: string;
  severity: "high" | "critical";
  status: "pending" | "reviewed" | "dismissed";
  created_at: string;
  reviewed_at: string | null;
};

function when(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function ChatFlagsPage() {
  const { supabase } = await requireAdminPage();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <Denied text="Log in as an admin." />;

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") return <Denied text="Admins only." />;

  const { data, error } = await supabase
    .from("chat_moderation_flags")
    .select(
      "id, booking_id, sender_id, sender_role, attempted_text, category, severity, status, created_at, reviewed_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <main style={wrap}>
        <AdminNav email={user.email ?? "Admin"} />
        <div style={content}>
          <div style={empty}>
            Could not load chat safety flags: {error.message}
          </div>
        </div>
      </main>
    );
  }

  const flags = (data ?? []) as Flag[];
  const senderIds = [...new Set(flags.map((flag) => flag.sender_id))];
  const bookingIds = [...new Set(flags.map((flag) => flag.booking_id))];
  const [profilesResult, providersResult, bookingsResult] = await Promise.all([
    senderIds.length
      ? supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", senderIds)
      : Promise.resolve({ data: [], error: null }),
    senderIds.length
      ? supabase
          .from("providers")
          .select("id, profile_id, display_name")
          .in("profile_id", senderIds)
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? supabase
          .from("bookings")
          .select("id, scheduled_at, address, packages(name)")
          .in("id", bookingIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const profileById = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile]),
  );
  const providerByProfile = new Map(
    (providersResult.data ?? []).map((provider) => [
      provider.profile_id,
      provider,
    ]),
  );
  const bookingById = new Map(
    (bookingsResult.data ?? []).map((booking) => [booking.id, booking]),
  );
  const pendingCount = flags.filter((flag) => flag.status === "pending").length;

  return (
    <main style={wrap}>
      <AdminNav email={user.email ?? "Admin"} />
      <div style={content}>
        <div style={headingRow}>
          <div>
            <h1 style={h1}>Chat safety</h1>
            <p style={lede}>
              Messages blocked for hate speech, threats or targeted abuse. Only
              the attempted message is retained for review.
            </p>
          </div>
          <span style={{ ...count, ...(pendingCount ? countAlarm : {}) }}>
            {pendingCount} pending
          </span>
        </div>

        {flags.length === 0 ? (
          <div style={empty}>No chat safety flags have been raised.</div>
        ) : (
          <div style={list}>
            {flags.map((flag) => {
              const profile = profileById.get(flag.sender_id);
              const provider = providerByProfile.get(flag.sender_id);
              const booking = bookingById.get(flag.booking_id);
              const pkg = one(
                booking?.packages as
                  | { name: string }
                  | { name: string }[]
                  | null,
              );
              const senderName =
                provider?.display_name ??
                profile?.full_name ??
                profile?.email ??
                "Unknown user";
              return (
                <article
                  className="admin-chat-flag-card"
                  key={flag.id}
                  style={{
                    ...card,
                    ...(flag.status === "pending" ? pendingCard : {}),
                  }}
                >
                  <div className="admin-chat-flag-top" style={cardTop}>
                    <div>
                      <div style={badges}>
                        <span
                          style={
                            flag.severity === "critical"
                              ? criticalBadge
                              : highBadge
                          }
                        >
                          {flag.severity}
                        </span>
                        <span style={statusBadge}>{flag.status}</span>
                      </div>
                      <h2 style={title}>
                        {String(flag.category).replace(/_/g, " ")}
                      </h2>
                      <p style={meta}>
                        {senderName} · {flag.sender_role} ·{" "}
                        {when(flag.created_at)}
                      </p>
                    </div>
                    {flag.sender_role === "provider" && provider ? (
                      <Link
                        href={`/admin/cleaners/${provider.id}`}
                        style={bookingLink}
                      >
                        Open cleaner
                      </Link>
                    ) : (
                      <Link
                        href={`/admin/customers/${flag.sender_id}`}
                        style={bookingLink}
                      >
                        Open customer
                      </Link>
                    )}
                  </div>

                  <blockquote style={evidence}>
                    {flag.attempted_text}
                  </blockquote>
                  <p style={bookingMeta}>
                    {pkg?.name ?? "Booking"}
                    {booking?.scheduled_at
                      ? ` · ${when(booking.scheduled_at)}`
                      : ""}
                    {booking?.address ? ` · ${booking.address}` : ""}
                  </p>

                  {flag.status === "pending" ? (
                    <div style={actions}>
                      <form action={reviewChatFlag}>
                        <input type="hidden" name="flagId" value={flag.id} />
                        <button
                          name="status"
                          value="reviewed"
                          style={reviewButton}
                        >
                          Mark reviewed
                        </button>
                      </form>
                      <form action={reviewChatFlag}>
                        <input type="hidden" name="flagId" value={flag.id} />
                        <button
                          name="status"
                          value="dismissed"
                          style={dismissButton}
                        >
                          Dismiss false flag
                        </button>
                      </form>
                      <Link href="/admin/bookings" style={cleanerLink}>
                        Open bookings
                      </Link>
                    </div>
                  ) : (
                    <p style={reviewed}>
                      Decision recorded
                      {flag.reviewed_at ? ` ${when(flag.reviewed_at)}` : ""}.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Denied({ text }: { text: string }) {
  return (
    <main style={{ ...wrap, display: "grid", placeItems: "center" }}>
      <div style={empty}>{text}</div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#F7F8FA",
  color: "#16202A",
  fontFamily: '"Nunito", system-ui, sans-serif',
};
const content: React.CSSProperties = {
  maxWidth: 1080,
  margin: "0 auto",
  padding: "20px 22px 80px",
};
const headingRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  marginBottom: 24,
};
const h1: React.CSSProperties = {
  margin: "0 0 5px",
  fontSize: 34,
  fontWeight: 950,
};
const lede: React.CSSProperties = {
  maxWidth: 680,
  margin: 0,
  color: "#68717D",
  fontSize: 15,
  lineHeight: 1.55,
};
const count: React.CSSProperties = {
  flexShrink: 0,
  borderRadius: 999,
  padding: "8px 13px",
  background: "#EEF0F3",
  color: "#58616D",
  fontSize: 13,
  fontWeight: 900,
};
const countAlarm: React.CSSProperties = {
  background: "#FFE6EA",
  color: "#B0384F",
};
const list: React.CSSProperties = { display: "grid", gap: 14 };
const card: React.CSSProperties = {
  border: "1px solid #E4E7EB",
  borderRadius: 18,
  padding: 20,
  background: "#FFF",
  boxShadow: "0 8px 22px rgba(22,32,42,.04)",
};
const pendingCard: React.CSSProperties = { borderColor: "#F2C6CF" };
const cardTop: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
};
const badges: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginBottom: 8,
};
const badgeBase: React.CSSProperties = {
  display: "inline-block",
  borderRadius: 999,
  padding: "4px 8px",
  fontSize: 10.5,
  fontWeight: 950,
  textTransform: "uppercase",
  letterSpacing: ".05em",
};
const criticalBadge: React.CSSProperties = {
  ...badgeBase,
  background: "#FFE6EA",
  color: "#B0384F",
};
const highBadge: React.CSSProperties = {
  ...badgeBase,
  background: "#FFF3D6",
  color: "#8A5A00",
};
const statusBadge: React.CSSProperties = {
  ...badgeBase,
  background: "#F1F2F4",
  color: "#58616D",
};
const title: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 950,
  textTransform: "capitalize",
};
const meta: React.CSSProperties = {
  margin: "3px 0 0",
  color: "#7A828C",
  fontSize: 13,
  fontWeight: 700,
};
const bookingLink: React.CSSProperties = {
  color: "#6D28D9",
  fontSize: 13,
  fontWeight: 900,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
const evidence: React.CSSProperties = {
  margin: "16px 0 10px",
  borderLeft: "4px solid #F0B5C1",
  borderRadius: "0 10px 10px 0",
  padding: "12px 14px",
  background: "#FFF7F8",
  color: "#3F4650",
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};
const bookingMeta: React.CSSProperties = {
  margin: 0,
  color: "#7A828C",
  fontSize: 12.5,
  fontWeight: 700,
};
const actions: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginTop: 16,
};
const buttonBase: React.CSSProperties = {
  borderRadius: 999,
  padding: "8px 12px",
  fontFamily: "inherit",
  fontSize: 12.5,
  fontWeight: 900,
  cursor: "pointer",
};
const reviewButton: React.CSSProperties = {
  ...buttonBase,
  border: 0,
  background: "#6D28D9",
  color: "#FFF",
};
const dismissButton: React.CSSProperties = {
  ...buttonBase,
  border: "1px solid #D9DDE3",
  background: "#FFF",
  color: "#58616D",
};
const cleanerLink: React.CSSProperties = {
  marginLeft: "auto",
  color: "#6D28D9",
  fontSize: 12.5,
  fontWeight: 900,
  textDecoration: "none",
};
const reviewed: React.CSSProperties = {
  margin: "14px 0 0",
  color: "#68717D",
  fontSize: 12.5,
  fontWeight: 800,
};
const empty: React.CSSProperties = {
  border: "1px solid #E4E7EB",
  borderRadius: 16,
  padding: 22,
  background: "#FFF",
  color: "#68717D",
  fontWeight: 800,
};
