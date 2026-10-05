// Admin dashboard — data overview + reset tools.
// Save at: app/admin/page.tsx
// Log in as admin@test.com, then visit localhost:3000/admin

import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import AdminButtons from "./AdminButtons";
import VettingButtons from "./VettingButtons";
import ReviewList from "./ReviewList";
import AdminNav from "./AdminNav";
import { loadAdminReviews } from "@/lib/adminReviews";
import { developmentToolsEnabled } from "@/lib/developmentTools";

async function count(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string
) {
  const { count: c } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  return c ?? 0;
}

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: p } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    role = p?.role ?? null;
  }

  if (role !== "admin") {
    return (
      <main style={wrap}>
        <link rel="stylesheet" href={FONTS} />
        <div style={{ ...card, maxWidth: 440, textAlign: "center" }}>
          <p style={eyebrow}>Admin</p>
          <h1 style={{ ...h1, fontSize: 27 }}>Admins only</h1>
          <p style={{ color: "#7A828C", margin: "0 0 22px" }}>
            {user
              ? "This account doesn't have admin access."
              : "Log in with an admin account to continue."}
          </p>
          <Link href="/staff/login" style={btn}>
            Go to admin login
          </Link>
        </div>
      </main>
    );
  }

  const [bookings, payments, providers, services, areas] = await Promise.all([
    count(supabase, "bookings"),
    count(supabase, "payments"),
    count(supabase, "providers"),
    count(supabase, "packages"),
    count(supabase, "service_areas"),
  ]);

  const { data: provRows } = await supabase
    .from("providers")
    .select(
      "id, display_name, services, vetting_status, dbs_verified, rating_avg, rating_count, profile:profiles!providers_profile_id_fkey(email)"
    );

  const pending = (provRows ?? []).filter(
    (p) => p.vetting_status === "pending"
  );

  const { reviews: recentReviews, error: reviewsError } =
    await loadAdminReviews(supabase, 3);

  return (
    <main style={{ ...wrap, display: "block", padding: "0 20px 80px" }}>
      <link rel="stylesheet" href={FONTS} />

      <AdminNav email={user?.email ?? "Admin"} />

      <div style={{ maxWidth: 1050, margin: "0 auto" }}>
        <p style={eyebrow}>Admin</p>
        <h1 style={h1}>Control panel</h1>
        <p style={{ color: "#7A828C", margin: "0 0 32px" }}>
          Signed in as {user?.email}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 12,
            marginBottom: 28,
          }}
        >
          {[
            ["/admin/bookings", "Bookings & schedule", "View bookings and make audited time changes."],
            ["/admin/customers", "Customers", "Contact details and booking history."],
            ["/admin/cleaners", "Cleaners", "Approvals, availability and workload."],
            ["/admin/deletion-requests", "Account requests", "Review and record account deletion requests."],
            ["/admin/legal", "Legal content", "Edit the customer terms, privacy policy and professional agreement."],
            ["/admin/review", "Reports", "Cases, payment blocks and reconciliation."],
          ].map(([href, label, copy]) => (
            <Link
              key={href}
              href={href}
              style={{
                ...card,
                padding: "17px 18px",
                color: "#16202A",
                textDecoration: "none",
              }}
            >
              <strong style={{ display: "block", fontSize: 15.5 }}>{label} →</strong>
              <span style={{ display: "block", marginTop: 4, color: "#7A828C", fontSize: 12.5, lineHeight: 1.4 }}>
                {copy}
              </span>
            </Link>
          ))}
        </div>

        <Link
          href="/admin/review"
          style={{
            ...card,
            display: "block",
            padding: "18px 20px",
            marginBottom: 34,
            color: "#16202A",
            textDecoration: "none",
            borderColor: "#DCCCF8",
          }}
        >
          <strong style={{ display: "block", fontSize: 17, marginBottom: 3 }}>
            Resolution desk →
          </strong>
          <span style={{ color: "#7A828C", fontSize: 14 }}>
            Review reconciliation findings, blocked cases, refunds and payouts.
          </span>
        </Link>

        {/* Counts */}
        <h2 style={sectionTitle}>What&apos;s in the database</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 12,
            marginBottom: 34,
          }}
        >
          {[
            ["Bookings", bookings],
            ["Payments", payments],
            ["Providers", providers],
            ["Services", services],
            ["Areas", areas],
          ].map(([label, n]) => (
            <div key={String(label)} style={{ ...card, padding: "18px 20px" }}>
              <p
                style={{
                  fontFamily: "'Nunito', system-ui, sans-serif",
                  fontSize: 28,
                  color: "#16202A",
                  margin: "0 0 2px",
                }}
              >
                {n as number}
              </p>
              <span style={{ color: "#7A828C", fontSize: 13.5 }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Vetting queue */}
        <h2 style={sectionTitle}>
          Awaiting approval{pending.length > 0 ? ` (${pending.length})` : ""}
        </h2>
        <div style={{ ...card, padding: "6px 20px", marginBottom: 34 }}>
          {pending.length === 0 ? (
            <p style={{ color: "#7A828C", padding: "16px 0" }}>
              Nothing waiting — all providers have been reviewed.
            </p>
          ) : (
            pending.map((p) => {
              const email =
                (Array.isArray(p.profile)
                  ? (p.profile as { email: string }[])[0]?.email
                  : (p.profile as { email: string } | null)?.email) ?? "—";
              return (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "16px 0",
                    borderBottom: "1px solid #F1F2F4",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 15 }}>
                      {p.display_name || email}
                    </strong>
                    <div style={{ color: "#7A828C", fontSize: 13 }}>
                      {email} · {(p.services ?? []).join(", ") || "no skills"}
                    </div>
                  </div>
                  <VettingButtons
                    id={p.id}
                    dbsVerified={p.dbs_verified === true}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Providers */}
        <h2 style={sectionTitle}>Providers</h2>
        <div style={{ ...card, padding: "6px 20px", marginBottom: 34 }}>
          {(provRows ?? []).length === 0 ? (
            <p style={{ color: "#7A828C", padding: "16px 0" }}>
              No providers yet.
            </p>
          ) : (
            (provRows ?? []).map((p) => {
              const email =
                (Array.isArray(p.profile)
                  ? (p.profile as { email: string }[])[0]?.email
                  : (p.profile as { email: string } | null)?.email) ?? "—";
              return (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 0",
                    borderBottom: "1px solid #F1F2F4",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 15 }}>{email}</strong>
                    <div style={{ color: "#7A828C", fontSize: 13 }}>
                      {(p.services ?? []).join(", ") || "no skills set"} ·{" "}
                      {p.vetting_status}
                      {p.rating_avg
                        ? ` · ${Number(p.rating_avg).toFixed(1)}★ (${p.rating_count})`
                        : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#68717D" }}>
                    {p.vetting_status === "approved" ? "Approved" : "Awaiting review"}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Reviews */}
        <div style={sectionHeading}>
          <div>
            <h2 style={{ ...sectionTitle, marginBottom: 3 }}>Recent reviews</h2>
            <p style={{ margin: 0, color: "#7A828C", fontSize: 12.5 }}>
              App activity covering cleaner and client reviews.
            </p>
          </div>
          <Link href="/admin/reviews" style={showAllLink}>Show all →</Link>
        </div>
        <div style={{ ...card, padding: "6px 20px", marginBottom: 34 }}>
          {reviewsError ? (
            <p style={{ color: "#a52e47", padding: "14px 0" }}>{reviewsError}</p>
          ) : (
            <ReviewList reviews={recentReviews} compact />
          )}
        </div>

        {developmentToolsEnabled(process.env) && (
          <section>
            <h2 style={sectionTitle}>Development tools</h2>
            <p style={{ color: "#7A828C", margin: "0 0 16px", fontSize: 14.5 }}>
              For test activity only. Each tool asks you to confirm first.
            </p>
            <AdminButtons />
          </section>
        )}

        <p style={{ marginTop: 30 }}>
          <Link href="/" style={{ color: "#6D28D9", fontSize: 14 }}>
            ← Back to site
          </Link>
        </p>
      </div>
    </main>
  );
}

const FONTS =
  "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap";

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#fff",
  color: "#16202A",
  fontFamily: "'Nunito', system-ui, sans-serif",
  display: "grid",
  placeItems: "center",
  padding: 24,
};
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #EDEFF1",
  borderRadius: 16,
  padding: "28px 26px",
};
const eyebrow: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  fontSize: 12,
  fontWeight: 600,
  color: "#6D28D9",
  margin: "0 0 6px",
};
const h1: React.CSSProperties = {
  fontFamily: "'Nunito', system-ui, sans-serif",
  fontWeight: 900,
  fontSize: 38,
  color: "#16202A",
  margin: "0 0 6px",
};
const sectionTitle: React.CSSProperties = {
  fontFamily: "'Nunito', system-ui, sans-serif",
  fontWeight: 900,
  fontSize: 22,
  color: "#16202A",
  margin: "0 0 14px",
};
const sectionHeading: React.CSSProperties = { display: "flex", alignItems: "end", justifyContent: "space-between", gap: 14, margin: "0 0 14px", flexWrap: "wrap" };
const showAllLink: React.CSSProperties = { borderRadius: 999, padding: "8px 14px", background: "#f4ecfe", color: "#6d28d9", fontSize: 12.5, fontWeight: 900, textDecoration: "none" };
const btn: React.CSSProperties = {
  display: "inline-block",
  background: "#16202A",
  color: "#FFFFFF",
  padding: "12px 26px",
  borderRadius: 999,
  textDecoration: "none",
  fontWeight: 600,
};
