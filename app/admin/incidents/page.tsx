import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import AdminNav from "../AdminNav";
import { deletionRequestAdminClient } from "../deletion-requests/data";
import ReviewForm from "./ReviewForm";
import styles from "../deletion-requests/page.module.css";

export default async function IncidentReportsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user } = await requireAdminPage();
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.page) || 1)));
  const admin = deletionRequestAdminClient();
  const result = admin ? await admin.from("account_incidents").select("id,reporter_id,booking_id,category,description,status,created_at,resolution_note,reporter:profiles!account_incidents_reporter_id_fkey(full_name,email)", { count: "exact" }).order("created_at", { ascending: false }).order("id").range((page - 1) * 30, page * 30 - 1) : null;
  return <main className={styles.shell}><AdminNav email={user.email ?? "Admin"} /><div className={styles.page}>
    <p className={styles.eyebrow}>Private support</p><h1>Problems and incidents</h1><p className={styles.intro}>Review client and professional reports. Only the support team sees this list.</p>
    {!result || result.error ? <p className={styles.error}>Reports could not be loaded.</p> : <>
      {!result.data.length && <p className={styles.empty}>No reports here yet.</p>}
      <div className={styles.list}>{result.data.map((item) => {
        const reporter = Array.isArray(item.reporter) ? item.reporter[0] : item.reporter;
        return <article key={item.id} className={styles.card}>
          <span className={styles.badge}>{item.status.replace('_', ' ')}</span><h3>{item.category} · {reporter?.full_name ?? "Account holder"}</h3>
          <p className={styles.meta}>{reporter?.email} · {new Date(item.created_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}</p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.description}</p>
          {item.booking_id && <><p className={styles.meta}>Booking reference: {item.booking_id}</p><Link href="/admin/bookings">Open bookings →</Link></>}
          {item.resolution_note && <p>{item.resolution_note}</p>}
          {item.status !== "resolved" && <ReviewForm id={item.id} />}
        </article>;
      })}</div>
      <div className={styles.recordLinks}>{page > 1 && <Link href={`/admin/incidents?page=${page - 1}`}>← Newer</Link>}{page * 30 < (result.count ?? 0) && <Link href={`/admin/incidents?page=${page + 1}`}>Older →</Link>}</div>
    </>}
  </div></main>;
}
