import { requireAdminPage } from "@/lib/adminSession";
import { retentionRules } from "@/lib/dataRetention";
import { deletionRequestAdminClient } from "../deletion-requests/data";
import styles from "../deletion-requests/page.module.css";
import HoldForm from "./HoldForm";

export const dynamic = "force-dynamic";

export default async function DataRetentionPage() {
  await requireAdminPage();
  const client = deletionRequestAdminClient();
  const result = client
    ? await client.rpc("data_retention_admin_report")
    : null;
  const report = result?.data as {
    enabled: boolean;
    runs: {
      id: string;
      started_at: string;
      finished_at: string | null;
      dry_run: boolean;
      summary: Record<string, number>;
    }[];
    pendingFiles: number;
    failedFiles: number;
    holds: number;
    openHolds: {
      id: string;
      user_id: string | null;
      booking_id: string | null;
      handyman_job_id: string | null;
      enquiry_id: string | null;
      partner_interest_id: string | null;
      reason: string;
    }[];
  } | null;
  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <h1>Data retention</h1>
        <p className={styles.intro}>
          The daily cleanup removes expired records and files. Open disputes,
          complaints and incidents protect all linked records until resolved.
        </p>
        {!report || result?.error ? (
          <p className={styles.error}>
            The retention report could not be loaded.
          </p>
        ) : (
          <>
            <article className={styles.card}>
              <h2>
                {report.enabled
                  ? "Automatic deletion enabled"
                  : "Preview only: deletion not enabled"}
              </h2>
              <p>
                {report.pendingFiles} file tasks awaiting cleanup.{" "}
                {report.failedFiles} need a retry. {report.holds} manual holds
                are active.
              </p>
              <p>
                No personal values or file contents are copied into this log. An
                unsuccessful cleanup stays pending and is retried.
              </p>
            </article>
            <h2>Protect records during a case</h2>
            <article className={styles.card}>
              <p>
                Disputes and incident reports are protected automatically. Add a
                hold here for a complaint or enquiry being handled elsewhere.
              </p>
              <HoldForm />
            </article>
            {report.openHolds.map((hold) => (
              <article className={styles.card} key={hold.id}>
                <p>
                  Reference:{" "}
                  {hold.booking_id ??
                    hold.handyman_job_id ??
                    hold.enquiry_id ??
                    hold.partner_interest_id ??
                    hold.user_id}
                </p>
                <p>{hold.reason}</p>
                <HoldForm id={hold.id} />
              </article>
            ))}
            <h2>Retention periods</h2>
            <div className={styles.list}>
              {retentionRules.map(([key, name, period]) => (
                <article className={styles.card} key={key}>
                  <h3>{name}</h3>
                  <p>{period}</p>
                </article>
              ))}
            </div>
            <h2>Daily runs</h2>
            {!report.runs.length && <p>No runs recorded yet.</p>}
            <div className={styles.list}>
              {report.runs.map((run) => (
                <article className={styles.card} key={run.id}>
                  <h3>
                    {new Date(run.started_at).toLocaleString("en-GB", {
                      timeZone: "Europe/London",
                    })}
                    {run.dry_run ? " · Preview" : " · Cleanup"}
                  </h3>
                  <p>
                    {run.finished_at
                      ? "Finished"
                      : "In progress or interrupted"}
                  </p>
                  <dl>
                    {Object.entries(run.summary).map(([label, count]) => (
                      <div key={label}>
                        <dt>{label.replaceAll("_", " ")}</dt>
                        <dd>{count}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
