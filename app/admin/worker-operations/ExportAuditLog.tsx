import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import { privatePortalClient } from "@/lib/professionalPortal";
import styles from "../deletion-requests/page.module.css";

export default async function ExportAuditLog({
  page,
  reliabilityPage,
  provider,
}: {
  page: number;
  reliabilityPage: number;
  provider?: string;
}) {
  await requireAdminPage();
  const result = await privatePortalClient()
    .from("professional_export_audits")
    .select(
      "id,actor_id,starts_on,ends_before,professional_count,created_at,actor:profiles!professional_export_audits_actor_id_fkey(full_name,email)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 30, page * 30 - 1);

  const pageLink = (target: number) => {
    const params = new URLSearchParams({
      auditPage: String(target),
      page: String(reliabilityPage),
    });
    if (provider) params.set("provider", provider);
    return `?${params}#csv-access-log`;
  };

  return (
    <section className={styles.section} aria-labelledby="csv-access-log">
      <h2 id="csv-access-log">Earnings CSV access log</h2>
      <p>
        Each authorised CSV request records the staff member, time, requested
        period and number of professional records. The file is only released
        once its audit entry is saved. Times below use London time. Personal
        details from the CSV are not copied into this log.
      </p>
      {result.error ? (
        <p className={styles.error}>The CSV access log could not be loaded.</p>
      ) : (
        <>
          {!result.data.length && <p>No earnings CSV requests recorded yet.</p>}
          <div className={styles.list}>
            {result.data.map((entry) => {
              const actor = Array.isArray(entry.actor)
                ? entry.actor[0]
                : entry.actor;
              return (
                <article className={styles.card} key={entry.id}>
                  <h3>{actor?.full_name || actor?.email || "Staff member"}</h3>
                  <p className={styles.meta}>
                    {actor?.email || `Staff reference: ${entry.actor_id}`}
                  </p>
                  <p>
                    Requested{" "}
                    <time dateTime={entry.created_at}>
                      {new Date(entry.created_at).toLocaleString("en-GB", {
                        timeZone: "Europe/London",
                        timeZoneName: "short",
                      })}
                    </time>
                  </p>
                  <p>
                    Period: {entry.starts_on} up to {entry.ends_before}{" "}
                    (exclusive).
                  </p>
                  <p>
                    {entry.professional_count < 0
                      ? "CSV generation not completed."
                      : `${entry.professional_count} professional records.`}
                  </p>
                  <p className={styles.meta}>Audit reference: {entry.id}</p>
                </article>
              );
            })}
          </div>
          <nav className={styles.recordLinks} aria-label="CSV access log pages">
            {page > 1 && <Link href={pageLink(page - 1)}>Newer requests</Link>}
            {page * 30 < (result.count ?? 0) && (
              <Link href={pageLink(page + 1)}>Older requests</Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
