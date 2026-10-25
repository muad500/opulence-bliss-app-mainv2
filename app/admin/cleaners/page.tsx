import AdminProfessionalOnboarding from "@/components/AdminProfessionalOnboarding";
import Link from "next/link";
import ServiceReview from "../ServiceReview";
import { handymanEnabled } from "@/lib/handymanMarketplace";
import { requireAdminPage } from "@/lib/adminSession";
import { setProviderDirectoryVisibility } from "../actions";
import { redirect } from "next/navigation";
import {
  ADMIN_PAGE_SIZE,
  adminPageNumber,
  adminListHref,
  pendingProfessionalFilter,
} from "@/lib/adminDashboard";
import Pagination from "../Pagination";
import styles from "../admin.module.css";

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

export default async function AdminCleanersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { supabase } = await requireAdminPage();
  const params = await searchParams;
  const currentPage = adminPageNumber(params.page);
  const selectedStatus = ["pending", "approved", "suspended"].includes(
    params.status ?? "",
  )
    ? params.status
    : undefined;
  let providerQuery = supabase
    .from("providers")
    .select(
      "id, display_name, services, service_approvals, vetting_status, dbs_verified, rating_avg, rating_count, years_experience, is_suspended, show_on_our_pros, profile:profiles!providers_profile_id_fkey(email), application:provider_onboarding_details(preferred_weekly_hours, resident_status, self_employed_confirmed, right_to_work, cleaning_experience_years, max_travel_distance)",
      { count: "exact" },
    );
  if (selectedStatus === "pending")
    providerQuery = providerQuery.or(
      pendingProfessionalFilter(handymanEnabled()),
    );
  if (selectedStatus === "approved")
    providerQuery = providerQuery
      .eq("vetting_status", "approved")
      .eq("is_suspended", false);
  if (selectedStatus === "suspended")
    providerQuery = providerQuery.eq("is_suspended", true);
  const providersResult = await providerQuery
    .order("created_at", { ascending: selectedStatus === "pending" })
    .order("id", { ascending: true })
    .range(
      (currentPage - 1) * ADMIN_PAGE_SIZE,
      currentPage * ADMIN_PAGE_SIZE - 1,
    );
  const total = providersResult.error ? null : providersResult.count;
  const lastPage = Math.max(1, Math.ceil((total ?? 0) / ADMIN_PAGE_SIZE));
  if (total !== null && currentPage > lastPage)
    redirect(
      adminListHref("/admin/cleaners", lastPage, { status: selectedStatus }),
    );
  const ids = (providersResult.data ?? []).map((provider) => provider.id);
  const [availabilityResult, jobsResult] = await Promise.all([
    ids.length
      ? supabase
          .from("provider_availability")
          .select("provider_id, weekday, start_time, end_time")
          .in("provider_id", ids)
          .order("weekday", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from("bookings")
          .select("provider_id, status")
          .in("provider_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const providers = providersResult.data ?? [];
  const hoursByProvider = new Map<string, string[]>();
  for (const row of availabilityResult.data ?? []) {
    const rows = hoursByProvider.get(row.provider_id) ?? [];
    rows.push(
      `${DAYS[row.weekday] ?? row.weekday} ${String(row.start_time).slice(0, 5)} to ${String(row.end_time).slice(0, 5)}`,
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

  return (
    <main style={page}>
      <div style={inner}>
        <Link href="/admin" className={styles.backLink}>
          ← Back to overview
        </Link>
        <h1 style={title}>
          {selectedStatus === "pending" ? "Awaiting approval" : "Professionals"}
        </h1>
        <p style={lede}>
          Review applications, approval status, skills, availability and current
          workload.
        </p>

        <nav className={styles.filters} aria-label="Professional status">
          {[
            [undefined, "All professionals"],
            ["pending", "Awaiting approval"],
            ["approved", "Approved"],
            ["suspended", "Suspended"],
          ].map(([status, label]) => (
            <Link
              key={label}
              className={styles.filter}
              aria-current={selectedStatus === status ? "page" : undefined}
              href={adminListHref("/admin/cleaners", 1, { status })}
            >
              {label}
            </Link>
          ))}
        </nav>
        {!selectedStatus && (
          <AdminProfessionalOnboarding handymanEnabled={handymanEnabled()} />
        )}
        {providersResult.error ? (
          <div style={errorBox}>{providersResult.error.message}</div>
        ) : providers.length === 0 ? (
          <div style={empty}>
            {selectedStatus
              ? "No professionals match this status."
              : "No professional accounts yet."}
          </div>
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
                      {(provider.services ?? [])
                        .map((service: string) =>
                          service === "handyman"
                            ? "Property maintenance"
                            : service,
                        )
                        .join(", ") || "No services set"}
                      {provider.years_experience
                        ? ` · ${provider.years_experience}+ years experience`
                        : ""}
                    </p>
                    <p style={meta}>
                      <strong>Application:</strong>{" "}
                      {application
                        ? `${application.right_to_work == null ? "Right to work not supplied" : application.right_to_work ? "Right to work: yes" : "Right to work: no"} · ${application.cleaning_experience_years ?? 0} years · ${application.preferred_weekly_hours ?? 0} hr/week · ${application.max_travel_distance ?? "Travel range not supplied"}`
                        : "Legacy account. No onboarding details submitted."}
                    </p>
                    <p style={meta}>
                      <strong>DBS:</strong>{" "}
                      {provider.dbs_verified ? "Verified" : "Not verified"}.
                      Private evidence is available to named onboarding staff
                      only.
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
                  {!provider.is_suspended ? (
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
        {!providersResult.error && (
          <Pagination
            path="/admin/cleaners"
            page={currentPage}
            total={total ?? null}
            filters={{ status: selectedStatus }}
          />
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
