"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "../deletion-requests/page.module.css";

type Decision = {
  id: number;
  action: string;
  hourly_pence: number | null;
  notice_received_on: string | null;
  absence_started_on: string | null;
  notice_reference: string;
  effective_at: string;
};

export default function ApprovedAbsencePay({
  providerId,
}: {
  providerId: string;
}) {
  const [history, setHistory] = useState<Decision[]>([]);
  const [eligible, setEligible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(false);
  async function load() {
    const response = await fetch(
      `/api/admin/cleaner-rate-retention?provider=${encodeURIComponent(providerId)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Records could not be loaded.");
    setHistory(result.history);
    setEligible(result.hasCompletedJob);
  }
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((cause: Error) => {
        setFeedback(cause.message);
        setError(true);
      })
      .finally(() => setLoading(false));
    // providerId identifies this mounted professional record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const retain = submitter?.value !== "release";
    setBusy(true);
    setFeedback("");
    setError(false);
    try {
      const response = await fetch("/api/admin/cleaner-rate-retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          retain,
          reference: fields.get("reference"),
          noticeReceived: fields.get("noticeReceived"),
          absenceStarted: fields.get("absenceStarted"),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "The decision could not be saved.");
      await load();
      form.reset();
      setFeedback(
        retain
          ? `Earned standard rate retained at £${(result.hourlyPence / 100).toFixed(2)} per hour for new bookings.`
          : "Exception ended for new bookings. Existing agreed pay is unchanged.",
      );
    } catch (cause) {
      setError(true);
      setFeedback(
        cause instanceof Error
          ? cause.message
          : "The decision could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.section}
      aria-labelledby="approved-absence-heading"
    >
      <h2 id="approved-absence-heading">Pay during an approved absence</h2>
      <p>
        Keep an earned standard cleaning rate after 90 days without completed
        work, when written notice was received in advance. Deep and end of
        tenancy rates stay unchanged. Decisions affect new bookings only.
      </p>
      {loading ? (
        <p role="status">Loading approved absence records…</p>
      ) : (
        <>
          <p>
            {history[0]?.action === "retain"
              ? `Current retained rate: £${((history[0].hourly_pence ?? 0) / 100).toFixed(2)}/hour.`
              : "No active pay exception."}
          </p>
          <form onSubmit={save} className={styles.actionForm}>
            <label className={styles.noteLabel}>
              Written notice received on
              <input name="noticeReceived" type="date" />
            </label>
            <label className={styles.noteLabel}>
              Absence started on
              <input name="absenceStarted" type="date" />
            </label>
            <label className={styles.noteLabel}>
              Written notice reference or reason for ending the exception
              <textarea
                name="reference"
                required
                minLength={8}
                maxLength={500}
                rows={2}
              />
            </label>
            <div className={styles.recordLinks}>
              <button
                className={styles.primaryButton}
                disabled={busy || !eligible}
                value="retain"
              >
                Keep earned standard rate
              </button>
              <button
                className={styles.secondaryButton}
                disabled={busy || history[0]?.action !== "retain"}
                value="release"
              >
                End exception for new bookings
              </button>
            </div>
            {!eligible && (
              <p>
                A completed cleaning job is needed before retaining an earned
                rate.
              </p>
            )}
          </form>
          {!!history.length && (
            <details>
              <summary>Decision history</summary>
              <ol>
                {history.map((row) => (
                  <li key={row.id}>
                    {row.action === "retain"
                      ? "Rate retained"
                      : "Exception ended"}{" "}
                    on {new Date(row.effective_at).toLocaleDateString("en-GB")}.{" "}
                    {row.notice_reference}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {feedback && (
        <p
          role={error ? "alert" : "status"}
          className={error ? styles.error : styles.success}
        >
          {feedback}
        </p>
      )}
    </section>
  );
}
