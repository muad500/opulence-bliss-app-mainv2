import Link from "next/link";
import { requireAdminPage } from "@/lib/adminSession";
import { privatePortalClient } from "@/lib/professionalPortal";
import styles from "../deletion-requests/page.module.css";

export const dynamic = "force-dynamic";
const london = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
export default async function PartnerInterestPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(params.page) || 1)),
  );
  const admin = privatePortalClient();
  const result = await admin
    .from("partner_interests")
    .select(
      "id,full_name,email,phone,description,created_at,consent_at,consent_wording,consent_ip,partner_registered_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 50, page * 50 - 1);
  const ids = (result.data ?? []).map((row) => row.id);
  const queue = ids.length
    ? await admin
        .from("partner_interest_email_queue")
        .select("interest_id,status,sent_at,attempts,last_error")
        .in("interest_id", ids)
    : { data: [], error: null };
  const mail = new Map((queue.data ?? []).map((row) => [row.interest_id, row]));
  const audit = await admin
    .from("partner_interest_export_audits")
    .select("id,actor_id,requested_at,completed_at,row_count")
    .order("requested_at", { ascending: false })
    .limit(30);
  const actors = [...new Set((audit.data ?? []).map((row) => row.actor_id))];
  const people = actors.length
    ? await admin.from("profiles").select("id,email").in("id", actors)
    : { data: [], error: null };
  const names = new Map((people.data ?? []).map((row) => [row.id, row.email]));
  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <h1>Partner interest</h1>
        <p className={styles.intro}>
          Contact requests for the Partner Programme. Registering interest does
          not create a Partner account or consent to marketing. Dates are shown
          in London time.
        </p>
        <div className={styles.recordLinks}>
          <a href="/api/admin/partner-interest/export">
            Download interest list CSV
          </a>
          <Link href="/admin/data-retention">Retention and case holds</Link>
        </div>
        <p className={styles.sectionHint}>
          Every CSV request records the staff member and time. Store exports
          securely. Interests expire after 12 months unless registered as a
          Partner or protected by an open case.
        </p>
        {result.error || queue.error ? (
          <p className={styles.error}>
            The Partner interest list could not be loaded.
          </p>
        ) : (
          <>
            <p>{result.count ?? 0} interests</p>
            <div className={styles.list}>
              {result.data?.map((row) => {
                const email = mail.get(row.id);
                return (
                  <article className={styles.card} key={row.id}>
                    <h2>{row.full_name}</h2>
                    <p>
                      <a href={`mailto:${row.email}`}>{row.email}</a>
                    </p>
                    <p>{row.phone}</p>
                    <p>{row.description}</p>
                    <p className={styles.meta}>
                      Registered interest {london(row.created_at)}
                    </p>
                    <p className={styles.meta}>Reference: {row.id}</p>
                    <p>Consent: “{row.consent_wording}”</p>
                    <p className={styles.meta}>
                      Given {london(row.consent_at)} · IP{" "}
                      {row.consent_ip ?? "Not available"}
                    </p>
                    <p>
                      Confirmation email: {email?.status ?? "Unavailable"}
                      {email?.sent_at ? ` · ${london(email.sent_at)}` : ""}
                    </p>
                    {email?.last_error && (
                      <p className={styles.meta}>{email.last_error}</p>
                    )}
                    <p>
                      {row.partner_registered_at
                        ? "Registered as a Partner"
                        : "Interest only; not registered as a Partner"}
                    </p>
                  </article>
                );
              })}
            </div>
            {!result.data?.length && (
              <p className={styles.empty}>
                No Partner interest records on this page.
              </p>
            )}
            <nav
              className={styles.recordLinks}
              aria-label="Partner interest pages"
            >
              {page > 1 && (
                <Link href={`/admin/partner-interest?page=${page - 1}`}>
                  Previous
                </Link>
              )}
              {page * 50 < (result.count ?? 0) && (
                <Link href={`/admin/partner-interest?page=${page + 1}`}>
                  Next
                </Link>
              )}
            </nav>
          </>
        )}
        <section className={styles.section}>
          <h2>CSV access log</h2>
          {audit.error || people.error ? (
            <p className={styles.error}>
              CSV access records could not be loaded.
            </p>
          ) : (
            <div className={styles.list}>
              {audit.data?.map((row) => (
                <article className={styles.card} key={row.id}>
                  <h3>{names.get(row.actor_id) ?? row.actor_id}</h3>
                  <p>{london(row.requested_at)}</p>
                  <p>
                    {row.completed_at
                      ? `${row.row_count} records exported`
                      : "Export requested; no completed download recorded"}
                  </p>
                </article>
              ))}
            </div>
          )}
          {!audit.data?.length && !audit.error && <p>No exports recorded.</p>}
        </section>
      </div>
    </main>
  );
}
