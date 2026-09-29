import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import AdminNav from "../AdminNav";
import { requireAdminPage } from "@/lib/adminSession";
import RequestActions from "./RequestActions";
import { deletionRequestAdminClient } from "./data";
import styles from "./page.module.css";

type RequestStatus = "pending" | "in_review" | "completed" | "declined";
type DeletionRequest = {
  id: string;
  user_id: string | null;
  status: RequestStatus;
  requested_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};
type Profile = { id: string; full_name: string | null; email: string | null; role: string | null };
type Provider = { id: string; profile_id: string };

const REQUEST_FIELDS = "id,user_id,status,requested_at,resolved_at,resolution_note";
const PAGE_SIZE = 500;

async function openRequests(admin: SupabaseClient) {
  const requests: DeletionRequest[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("account_deletion_requests")
      .select(REQUEST_FIELDS)
      .in("status", ["pending", "in_review"])
      .order("requested_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { requests: [], error: error.message };
    const batch = (data ?? []) as DeletionRequest[];
    requests.push(...batch);
    if (batch.length < PAGE_SIZE) return { requests, error: null };
  }
}

function when(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function chunks<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

export default async function AdminDeletionRequestsPage() {
  const { user } = await requireAdminPage();
  const admin = deletionRequestAdminClient();
  if (!admin) {
    return (
      <main className={styles.shell}>
        <AdminNav email={user.email ?? "Admin"} />
        <div className={styles.page}><h1>Account requests</h1><p className={styles.error}>The account request service is unavailable.</p></div>
      </main>
    );
  }

  const [openResult, recentResult] = await Promise.all([
    openRequests(admin),
    admin.from("account_deletion_requests")
      .select(REQUEST_FIELDS)
      .in("status", ["completed", "declined"])
      .order("resolved_at", { ascending: false })
      .limit(50),
  ]);
  const loadError = openResult.error ?? recentResult.error?.message ?? null;
  const open = openResult.requests;
  const recent = (recentResult.data ?? []) as DeletionRequest[];
  const userIds = [...new Set([...open, ...recent].map((request) => request.user_id).filter((id): id is string => Boolean(id)))];
  const profileResults = await Promise.all(chunks(userIds, 100).map((ids) =>
    admin.from("profiles").select("id,full_name,email,role").in("id", ids),
  ));
  const providerResults = await Promise.all(chunks(userIds, 100).map((ids) =>
    admin.from("providers").select("id,profile_id").in("profile_id", ids),
  ));
  const peopleError = [...profileResults, ...providerResults].find((result) => result.error)?.error?.message ?? null;
  const profiles = new Map(profileResults.flatMap((result) => (result.data ?? []) as Profile[]).map((profile) => [profile.id, profile]));
  const providers = new Map(providerResults.flatMap((result) => (result.data ?? []) as Provider[]).map((provider) => [provider.profile_id, provider]));
  const pendingCount = open.filter((request) => request.status === "pending").length;

  return (
    <main className={styles.shell}>
      <AdminNav email={user.email ?? "Admin"} />
      <div className={styles.page}>
        <p className={styles.eyebrow}>Privacy operations</p>
        <div className={styles.heading}>
          <div>
            <h1>Account deletion requests</h1>
            <p className={styles.intro}>Review each request, check active bookings and required record retention, then record the outcome. Changing a status here does not delete an account or its data.</p>
          </div>
          <span className={styles.count}>{pendingCount} pending · {open.length - pendingCount} in review</span>
        </div>

        {loadError && <p className={styles.error} role="alert">Could not load requests: {loadError}</p>}
        {peopleError && <p className={styles.error} role="alert">Some account details could not be loaded: {peopleError}</p>}

        {!loadError && (
          <>
            <section aria-labelledby="open-requests" className={styles.section}>
              <h2 id="open-requests">Open requests</h2>
              {open.length === 0 ? <p className={styles.empty}>No requests are waiting for review.</p> : (
                <div className={styles.list}>
                  {open.map((request) => (
                    <RequestCard key={request.id} request={request} profile={request.user_id ? profiles.get(request.user_id) : undefined} provider={request.user_id ? providers.get(request.user_id) : undefined} />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="recent-outcomes" className={styles.section}>
              <h2 id="recent-outcomes">Recent outcomes</h2>
              <p className={styles.sectionHint}>The 50 most recently closed requests.</p>
              {recent.length === 0 ? <p className={styles.empty}>No requests have been closed yet.</p> : (
                <div className={styles.list}>
                  {recent.map((request) => (
                    <RequestCard key={request.id} request={request} profile={request.user_id ? profiles.get(request.user_id) : undefined} provider={request.user_id ? providers.get(request.user_id) : undefined} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function RequestCard({ request, profile, provider }: { request: DeletionRequest; profile?: Profile; provider?: Provider }) {
  const label = request.status === "in_review" ? "In review" : request.status.charAt(0).toUpperCase() + request.status.slice(1);
  const accountLink = provider
    ? { href: `/admin/cleaners/${provider.id}`, text: "Open professional record" }
    : profile?.role === "customer" && request.user_id
      ? { href: `/admin/customers/${request.user_id}`, text: "Open customer record" }
      : null;

  return (
    <article className={styles.card}>
      <div className={styles.cardHeading}>
        <div>
          <span className={`${styles.badge} ${styles[request.status]}`}>{label}</span>
          <h3>{profile?.full_name || profile?.email || "Account holder"}</h3>
          <p className={styles.meta}>{request.user_id ? profile?.email || "Email unavailable" : "Account removed"} · {profile?.role || "Account"}</p>
        </div>
        <p className={styles.date}>Requested {when(request.requested_at)}</p>
      </div>
      <div className={styles.recordLinks}>
        {accountLink && <Link href={accountLink.href}>{accountLink.text} →</Link>}
        <Link href="/admin/bookings">Check bookings →</Link>
      </div>
      <p className={styles.requestId}>Request ID: {request.id}</p>
      {request.resolution_note && <div className={styles.outcome}><strong>Outcome note</strong><p>{request.resolution_note}</p></div>}
      {request.resolved_at && <p className={styles.date}>Closed {when(request.resolved_at)}</p>}
      {(request.status === "pending" || request.status === "in_review") && <RequestActions id={request.id} status={request.status} />}
    </article>
  );
}
