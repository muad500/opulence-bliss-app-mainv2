import AdminNav from "../AdminNav";
import Link from "next/link";
import ServiceReview from "../ServiceReview";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { requireAdminPage } from "@/lib/adminSession";
import { setProviderDirectoryVisibility } from "../actions";
import { dbsRecheckDate, renewalState } from "@/lib/verificationRenewal";

function profileOf(value: unknown) {
  if (Array.isArray(value)) return value[0] as { email?: string } | undefined;
  return value as { email?: string } | null;
}

function applicationOf(value: unknown) {
  if (Array.isArray(value)) {
    return value[0] as
      | {
          preferred_weekly_hours?: number;
          resident_status?: string;
          self_employed_confirmed?: boolean;
          right_to_work?: boolean;
          cleaning_experience_years?: number;
          max_travel_distance?: string;
        }
      | undefined;
  }
  return value as {
    preferred_weekly_hours?: number;
    resident_status?: string;
    self_employed_confirmed?: boolean;
    right_to_work?: boolean;
    cleaning_experience_years?: number;
    max_travel_distance?: string;
  } | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function AdminCleanersPage() {
  const { supabase, user } = await requireAdminPage();
  const [providersResult, availabilityResult, jobsResult, dbsResult] =
    await Promise.all([
      supabase
        .from("providers")
        .select(
          "id, display_name, services, service_approvals, vetting_status, dbs_verified, rating_avg, rating_count, years_experience, is_suspended, show_on_our_pros, profile:profiles!providers_profile_id_fkey(email), application:provider_onboarding_details(preferred_weekly_hours, resident_status, self_employed_confirmed, right_to_work, cleaning_experience_years, max_travel_distance)",
        )
        .order("display_name", { ascending: true }),
      supabase
        .from("provider_availability")
        .select("provider_id, weekday, start_time, end_time")
        .order("weekday", { ascending: true }),
      supabase.from("bookings").select("provider_id, status"),
      supabase
        .from("provider_dbs_checks")
        .select("provider_id, status, uploaded_at,issue_date"),
    ]);

  const providers = providersResult.data ?? [];
  const hoursByProvider = new Map<string, string[]>();
  for (const row of availabilityResult.data ?? []) {
    const rows = hoursByProvider.get(row.provider_id) ?? [];
    rows.push(
      `${DAYS[row.weekday] ?? row.weekday} ${String(row.start_time).slice(0, 5)}–${String(row.end_time).slice(0, 5)}`,
    );
    hoursByProvider.set(row.provider_id, rows);
  }
  const jobsByProvider = new Map<
    string,
    { completed: number; upcoming: number }
  >();
  for (const job of jobsResult.data ?? []) {
    if (!job.provider_id) continue;
    const summary = jobsByProvider.get(job.provider_id) ?? {
      completed: 0,
      upcoming: 0,
    };
    if (job.status === "completed") summary.completed += 1;
    if (["scheduled", "in_progress"].includes(job.status))
      summary.upcoming += 1;
    jobsByProvider.set(job.provider_id, summary);
  }
  const dbsByProvider = new Map(
    (dbsResult.data ?? []).map((check) => [check.provider_id, check]),
  );

  return (
    <main style={page}>
      <AdminNav email={user.email ?? "Admin"} />
      <div style={inner}>
        <p style={eyebrow}>Workforce</p>
        <h1 style={title}>Cleaners &amp; professionals</h1>
        <p style={lede}>
          Review applications, approval status, skills, availability and current
          workload.
        </p>

        {providersResult.error ? (
          <div style={errorBox}>{providersResult.error.message}</div>
        ) : providers.length === 0 ? (
          <div style={empty}>No cleaner accounts yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {providers.map((provider) => {
              const profile = profileOf(provider.profile);
              const application = applicationOf(provider.application);
              const hours = hoursByProvider.get(provider.id) ?? [];
              const jobs = jobsByProvider.get(provider.id) ?? {
                completed: 0,
                upcoming: 0,
              };
              const pending = provider.vetting_status === "pending";
              const dbs = dbsByProvider.get(provider.id);
              const dbsLabel = !dbs
                ? "not submitted"
                : !dbs.uploaded_at
                  ? "upload incomplete"
                  : dbs.status;

              return (
                <article
                  className="admin-cleaner-card"
                  key={provider.id}
                  style={card}
                >
                  <div style={avatar}>
                    {(provider.display_name ?? profile?.email ?? "P")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={topline}>
                      <h2 style={name}>
                        {provider.display_name ?? "Unnamed professional"}
                      </h2>
                      <span
                        style={{
                          ...status,
                          background: provider.is_suspended
                            ? "#ffe6ea"
                            : provider.vetting_status === "approved"
                              ? "#dff5e8"
                              : pending
                                ? "#fff3d6"
                                : "#ffe6ea",
                          color: provider.is_suspended
                            ? "#b0384f"
                            : provider.vetting_status === "approved"
                              ? "#137b4e"
                              : pending
                                ? "#8a5a00"
                                : "#b0384f",
                        }}
                      >
                        {provider.is_suspended
                          ? "suspended"
                          : provider.vetting_status}
                      </span>
                    </div>
                    <p style={email}>{profile?.email ?? "No email"}</p>
                    <p style={meta}>
                      {(provider.services ?? []).join(", ") ||
                        "No services set"}
                      {provider.years_experience
                        ? ` · ${provider.years_experience}+ years experience`
                        : ""}
                    </p>
                    <p style={meta}>
                      <strong>Application:</strong>{" "}
                      {application
                        ? `${application.right_to_work == null ? "Right-to-work not supplied" : application.right_to_work ? "Right to work: yes" : "Right to work: no"} · ${application.cleaning_experience_years ?? 0} years · ${application.preferred_weekly_hours ?? 0} hr/week · ${application.max_travel_distance ?? "Travel range not supplied"}`
                        : "Legacy account — no onboarding details submitted"}
                    </p>
                    <p style={meta}>
                      <strong>DBS:</strong> {dbsLabel}
                      {dbs?.issue_date && (
                        <>
                          {" "}
                          · Annual re-check {dbsRecheckDate(dbs.issue_date)} (
                          {renewalState(
                            dbsRecheckDate(dbs.issue_date),
                            new Date().toISOString().slice(0, 10),
                          )}
                          )
                        </>
                      )}
                    </p>
                    <p style={meta}>
                      {provider.rating_avg
                        ? `${Number(provider.rating_avg).toFixed(1)} ★ (${provider.rating_count ?? 0})`
                        : "Not rated"}
                      {` · ${jobs.completed} completed · ${jobs.upcoming} upcoming`}
                    </p>
                    <p style={hoursText}>
                      <strong>Hours:</strong>{" "}
                      {hours.length ? hours.join(" · ") : "Not available"}
                    </p>
                    <div>
                      <Link
                        href={`/admin/cleaners/${provider.id}`}
                        style={viewLink}
                      >
                        View full professional record →
                      </Link>
                    </div>
                  </div>
                  {provider.vetting_status === "approved" ||
                  (pending && !provider.is_suspended) ? (
                    <div className="admin-cleaner-actions" style={cardActions}>
                      {provider.vetting_status === "approved" ? (
                        <>
                          <span style={directoryState}>
                            {provider.is_suspended
                              ? "Hidden while suspended"
                              : !provider.dbs_verified
                                ? "Hidden until DBS is verified"
                                : provider.show_on_our_pros
                                  ? "Shown on Our Pros"
                                  : "Hidden from Our Pros"}
                          </span>
                          {provider.dbs_verified ? (
                            <form
                              action={setProviderDirectoryVisibility.bind(
                                null,
                                provider.id,
                                !provider.show_on_our_pros,
                              )}
                            >
                              <button
                                type="submit"
                                style={
                                  provider.show_on_our_pros
                                    ? hideButton
                                    : showButton
                                }
                              >
                                {provider.show_on_our_pros
                                  ? "Hide from Our Pros"
                                  : "Show on Our Pros"}
                              </button>
                            </form>
                          ) : null}
                        </>
                      ) : null}
                      {!provider.is_suspended ? (
                        <ServiceReview
                          id={provider.id}
                          approvals={provider.service_approvals}
                          handymanEnabled={handymanEnabled()}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f7f8fa",
  color: "#16202a",
  fontFamily: "'Nunito', system-ui, sans-serif",
  paddingBottom: 80,
};
const inner: React.CSSProperties = {
  maxWidth: 1050,
  margin: "0 auto",
  padding: "0 20px",
};
const eyebrow: React.CSSProperties = {
  margin: "0 0 5px",
  color: "#6d28d9",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.13em",
  textTransform: "uppercase",
};
const title: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 34,
  fontWeight: 900,
};
const lede: React.CSSProperties = {
  margin: "0 0 24px",
  color: "#68717d",
  fontSize: 14.5,
};
const card: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "52px minmax(0, 1fr) auto",
  alignItems: "start",
  gap: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 15,
  padding: 17,
  background: "#fff",
};
const avatar: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 52,
  height: 52,
  borderRadius: "50%",
  background: "#f4ecfe",
  color: "#6d28d9",
  fontSize: 19,
  fontWeight: 900,
};
const topline: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};
const name: React.CSSProperties = {
  margin: 0,
  fontSize: 16.5,
  fontWeight: 900,
};
const status: React.CSSProperties = {
  borderRadius: 999,
  padding: "4px 9px",
  fontSize: 10.5,
  fontWeight: 900,
  textTransform: "capitalize",
};
const email: React.CSSProperties = {
  margin: "3px 0 7px",
  color: "#4b5563",
  fontSize: 12.5,
  overflowWrap: "anywhere",
};
const meta: React.CSSProperties = {
  margin: "3px 0",
  color: "#68717d",
  fontSize: 12.5,
};
const hoursText: React.CSSProperties = {
  margin: "8px 0",
  color: "#4b5563",
  fontSize: 11.5,
  lineHeight: 1.5,
};
const viewLink: React.CSSProperties = {
  display: "inline-block",
  marginTop: 10,
  color: "#6d28d9",
  fontSize: 12,
  fontWeight: 900,
  textDecoration: "none",
};
const cardActions: React.CSSProperties = {
  display: "grid",
  justifyItems: "stretch",
  gap: 8,
  minWidth: 170,
};
const directoryState: React.CSSProperties = {
  color: "#68717d",
  fontSize: 11,
  fontWeight: 900,
  textAlign: "center",
};
const directoryButton: React.CSSProperties = {
  width: "100%",
  borderRadius: 999,
  padding: "9px 13px",
  background: "#fff",
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const hideButton: React.CSSProperties = {
  ...directoryButton,
  border: "1.5px solid #efb5c1",
  color: "#a52e47",
};
const showButton: React.CSSProperties = {
  ...directoryButton,
  border: "1.5px solid #b9dfc7",
  color: "#137b4e",
};
const empty: React.CSSProperties = {
  border: "1px dashed #d8dde3",
  borderRadius: 15,
  padding: 30,
  background: "#fff",
  color: "#7a828c",
  textAlign: "center",
};
const errorBox: React.CSSProperties = {
  ...empty,
  borderColor: "#f0c5cf",
  background: "#fff7f8",
  color: "#a52e47",
};
