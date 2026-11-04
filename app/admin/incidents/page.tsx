import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import { deletionRequestAdminClient } from "../deletion-requests/data";
import ReviewForm from "./ReviewForm";
import CreateForm from "./CreateForm";
import ResponseForm from "./ResponseForm";
import styles from "../deletion-requests/page.module.css";

export default async function IncidentReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  const admin = deletionRequestAdminClient();
  const result = admin
    ? await admin
        .from("account_incidents")
        .select(
          "id,reporter_id,booking_id,subject_provider_id,log_kind,category,description,status,created_at,resolution_note,complaint_reference,complaint_kind,complainant_email,handler_name,acknowledgement_due_at,acknowledgement_sent_at,reply_due_at,reply_sent_at,complex_update_sent_at,reporter:profiles!account_incidents_reporter_id_fkey(full_name,email)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range((page - 1) * 30, page * 30 - 1)
    : null;
  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <h1>Complaints, breaches and incidents</h1>
        <p className={styles.intro}>
          Review client and professional reports. Only the support team sees
          this list.
        </p>
        <CreateForm />
        {!result || result.error ? (
          <p className={styles.error}>Reports could not be loaded.</p>
        ) : (
          <>
            {!result.data.length && (
              <p className={styles.empty}>No reports here yet.</p>
            )}
            <div className={styles.list}>
              {result.data.map((item) => {
                const reporter = Array.isArray(item.reporter)
                  ? item.reporter[0]
                  : item.reporter;
                return (
                  <article key={item.id} className={styles.card}>
                    <span className={styles.badge}>
                      {item.status.replace("_", " ")}
                    </span>
                    <h3>
                      {item.log_kind} · {item.category} ·{" "}
                      {reporter?.full_name ?? "Account holder"}
                    </h3>
                    <p className={styles.meta}>
                      {reporter?.email} ·{" "}
                      {new Date(item.created_at).toLocaleString("en-GB", {
                        timeZone: "Europe/London",
                      })}
                    </p>
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {item.description}
                    </p>
                    {item.booking_id && (
                      <>
                        <p className={styles.meta}>
                          Booking reference: {item.booking_id}
                        </p>
                        <Link href="/admin/bookings">Open bookings →</Link>
                      </>
                    )}
                    {item.resolution_note && <p>{item.resolution_note}</p>}
                    {item.complaint_reference && (
                      <section>
                        <h4>{item.complaint_reference}</h4>
                        <p>
                          Contact: {item.complainant_email} · Handler:{" "}
                          {item.handler_name}
                        </p>
                        <p>
                          Acknowledgement:{" "}
                          {item.acknowledgement_sent_at
                            ? "Sent"
                            : `Due ${new Date(item.acknowledgement_due_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}`}
                        </p>
                        <p>
                          Full reply:{" "}
                          {item.reply_sent_at
                            ? "Sent"
                            : `Due ${new Date(item.reply_due_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}`}
                        </p>
                        {item.complaint_kind === "complex" &&
                          !item.complex_update_sent_at && (
                            <p>
                              Send an update by day 14 explaining the delay.
                            </p>
                          )}
                        {!item.reply_sent_at && <ResponseForm id={item.id} />}
                      </section>
                    )}
                    {item.subject_provider_id && (
                      <Link
                        href={`/admin/cleaners/${item.subject_provider_id}`}
                      >
                        Open professional record
                      </Link>
                    )}
                    {item.status !== "resolved" && <ReviewForm id={item.id} />}
                  </article>
                );
              })}
            </div>
            <div className={styles.recordLinks}>
              {page > 1 && (
                <Link href={`/admin/incidents?page=${page - 1}`}>← Newer</Link>
              )}
              {page * 30 < (result.count ?? 0) && (
                <Link href={`/admin/incidents?page=${page + 1}`}>Older →</Link>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
