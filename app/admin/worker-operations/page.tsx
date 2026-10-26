import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import { privatePortalClient } from "@/lib/professionalPortal";
import { graceCancellationsLeft, londonMonth } from "@/lib/workerOperations";
import styles from "../deletion-requests/page.module.css";

export default async function WorkerOperations({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; page?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const month = londonMonth();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  const admin = privatePortalClient();
  let query = admin
    .from("cleaner_reliability_events")
    .select(
      "id,provider_id,booking_id,kind,occurred_at,month_start,review_case_id",
      { count: "exact" },
    )
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 50, page * 50 - 1);
  if (params.provider && /^[0-9a-f-]{36}$/i.test(params.provider))
    query = query.eq("provider_id", params.provider);
  const events = await query;
  const ids = [...new Set((events.data ?? []).map((row) => row.provider_id))];
  const [professionals, cancellations] = ids.length
    ? await Promise.all([
        admin.from("providers").select("id,display_name").in("id", ids),
        admin
          .from("cleaner_reliability_events")
          .select("provider_id")
          .in("provider_id", ids)
          .eq("kind", "cancellation")
          .eq("month_start", month),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const names = new Map(
    (professionals.data ?? []).map((row) => [row.id, row.display_name]),
  );
  const counts = new Map<string, number>();
  for (const row of cancellations.data ?? [])
    counts.set(row.provider_id, (counts.get(row.provider_id) ?? 0) + 1);
  const year = new Date().getFullYear();
  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <h1>Professional operations</h1>
        <p className={styles.intro}>
          Two grace cancellations per London calendar month. The third alerts
          admin once. No-show reports need review and do not automatically
          suspend anyone.
        </p>
        <section className={styles.section}>
          <h2>Reliability log</h2>
          {events.error || professionals.error || cancellations.error ? (
            <p className={styles.error}>
              Reliability records could not be loaded.
            </p>
          ) : (
            <>
              {!events.data?.length && (
                <p>No cancellations or no-show reports recorded yet.</p>
              )}
              <div className={styles.list}>
                {events.data?.map((row) => (
                  <article key={row.id} className={styles.card}>
                    <h3>
                      <Link href={`/admin/cleaners/${row.provider_id}`}>
                        {names.get(row.provider_id) ?? "Professional"}
                      </Link>
                    </h3>
                    <p>
                      {row.kind === "cancellation"
                        ? "Accepted visit cancelled"
                        : "No-show reported, awaiting case review"}
                    </p>
                    <p className={styles.meta}>
                      {new Date(row.occurred_at).toLocaleString("en-GB", {
                        timeZone: "Europe/London",
                      })}{" "}
                      · Booking {row.booking_id}
                    </p>
                    <p>
                      This month: {counts.get(row.provider_id) ?? 0}{" "}
                      cancellations ·{" "}
                      {graceCancellationsLeft(counts.get(row.provider_id) ?? 0)}{" "}
                      grace cancellations left.
                    </p>
                    {row.review_case_id && (
                      <Link href="/admin/review">
                        Review the reported incident
                      </Link>
                    )}
                  </article>
                ))}
              </div>
              <div className={styles.recordLinks}>
                {page > 1 && (
                  <Link
                    href={`?page=${page - 1}${params.provider ? `&provider=${encodeURIComponent(params.provider)}` : ""}`}
                  >
                    Newer
                  </Link>
                )}
                {page * 50 < (events.count ?? 0) && (
                  <Link
                    href={`?page=${page + 1}${params.provider ? `&provider=${encodeURIComponent(params.provider)}` : ""}`}
                  >
                    Older
                  </Link>
                )}
              </div>
            </>
          )}
        </section>
        <section className={styles.section}>
          <h2>Professional earnings export</h2>
          <p>
            Private CSV for tax reconciliation, including address, date of
            birth, UTR and current net paid earnings including tips. Missing
            details are flagged. Paid transfers only; this does not file a
            return with HMRC. Reversed amounts are deducted as recorded at
            export time. Keep the file secure.
          </p>
          <form
            action="/api/admin/professional-earnings-export"
            className={styles.actionForm}
          >
            <label className={styles.noteLabel}>
              From, inclusive
              <input
                name="from"
                type="date"
                required
                defaultValue={`${year - 1}-04-06`}
              />
            </label>
            <label className={styles.noteLabel}>
              Until, exclusive
              <input
                name="to"
                type="date"
                required
                defaultValue={`${year}-04-06`}
              />
            </label>
            <button className={styles.primaryButton}>
              Download private CSV
            </button>
          </form>
        </section>
        <p className={styles.recordLinks}>
          <Link href="/admin/incidents">Complaints and breach log</Link>
        </p>
      </div>
    </main>
  );
}
