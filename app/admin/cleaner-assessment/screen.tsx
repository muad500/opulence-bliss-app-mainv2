"use client";
import { useCallback, useEffect, useState } from "react";
import { CLEANER_ONBOARDING_MISSING_SOURCES } from "@/lib/cleanerOnboardingPlaceholders";
import styles from "./screen.module.css";

type Applicant = {
  application_id: string;
  full_name: string;
  status: string;
  legal_hold: boolean;
  host_session_id: string;
  host_open: boolean;
  attendance_confirmed: boolean;
  adjustment: number;
  reopens_used: number;
  attempt_id: string | null;
  phase: string | null;
  position: number | null;
  score: number | null;
  failure_reason: string | null;
  writing_text: string | null;
};
type State = {
  applicants: Applicant[];
  settings: { confirmAutomaticFail: boolean };
  staffRole: string;
};
const endpoint = "/api/admin/cleaner-assessment";
export default function AssessmentConsole() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setState(data);
      setError("");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Unable to load assessments.",
      );
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  async function action(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setReason("");
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Action refused.");
    } finally {
      setBusy(false);
    }
  }
  const manager = state?.staffRole === "manager";
  const reviewer = manager || state?.staffRole === "onboarding";
  const needsReason = busy || reason.trim().length < 10;
  return (
    <main className={styles.page}>
      <p className={styles.test}>
        STAGING ONLY · fictional applicants for testing
      </p>
      <h1>Induction and assessment</h1>
      <p>
        Record attendance yourself. Open the assessment when the induction is
        ready. There is no Google Meet integration.
      </p>
      <button disabled={busy} onClick={() => void load()}>
        Refresh progress
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <section className={styles.card}>
        <h2>Decision controls</h2>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={state?.settings.confirmAutomaticFail ?? false}
            disabled={!state || !manager || needsReason}
            onChange={(event) =>
              void action({
                action: "automatic_fail",
                enabled: event.target.checked,
              })
            }
          />
          Staff confirm each automatic fail before it is final
        </label>
        <p>
          Off by default. A Manager can change this with a reason. Writing
          failures always wait for Manager review.
        </p>
        <label>
          Reason for your next attendance, marking or decision action
          <textarea
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p>
          Do not put medical information in this field. Timing adjustments store
          only “adjustment granted”.
        </p>
      </section>
      {!state && !error && <p>Loading assessments…</p>}
      {state?.applicants.length === 0 && <p>No invited applicants.</p>}
      {state?.applicants.map((applicant) => (
        <section key={applicant.application_id} className={styles.card}>
          <h2>{applicant.full_name}</h2>
          <p>
            {applicant.status} · {applicant.phase ?? "Not started"}
            {applicant.phase === "questions" &&
              ` · Question ${applicant.position} of 15`}
            {applicant.score !== null && ` · Part A ${applicant.score}/15`}
          </p>
          {applicant.failure_reason && (
            <p className={styles.error}>
              Assessment flag: {applicant.failure_reason}. Record the human
              follow-up; the system does not remove people from a call.
            </p>
          )}
          <div className={styles.actions}>
            {manager && (
              <button
                disabled={needsReason}
                onClick={() =>
                  void action({
                    action: "legal_hold",
                    applicationId: applicant.application_id,
                    hold: !applicant.legal_hold,
                  })
                }
              >
                {applicant.legal_hold ? "Release legal hold" : "Set legal hold"}
              </button>
            )}
            <button
              disabled={!reviewer || needsReason}
              onClick={() =>
                void action({
                  action: "host",
                  hostId: applicant.host_session_id,
                  open: !applicant.host_open,
                })
              }
            >
              {applicant.host_open
                ? "Close assessment session"
                : "Open assessment session"}
            </button>
            <button
              disabled={!reviewer || needsReason}
              onClick={() =>
                void action({
                  action: "attendance",
                  hostId: applicant.host_session_id,
                  applicationId: applicant.application_id,
                  attended: !applicant.attendance_confirmed,
                  open: applicant.host_open,
                })
              }
            >
              {applicant.attendance_confirmed
                ? "Mark not attended"
                : "Record attendance"}
            </button>
          </div>
          <label>
            Time adjustment
            <select
              value={applicant.adjustment}
              disabled={busy || !reviewer || !!applicant.attempt_id}
              onChange={(event) =>
                void action({
                  action: "adjustment",
                  applicationId: applicant.application_id,
                  multiplier: Number(event.target.value),
                })
              }
            >
              <option value={1}>Standard time</option>
              <option value={2}>Double time</option>
              <option value={3}>Triple time</option>
            </select>
          </label>
          {applicant.writing_text && (
            <>
              <h3>Part B writing</h3>
              <p className={styles.writing}>{applicant.writing_text}</p>
            </>
          )}
          {applicant.phase === "writing_review" && (
            <div className={styles.actions}>
              <button
                disabled={!reviewer || needsReason}
                onClick={() =>
                  void action({
                    action: "mark_writing",
                    attemptId: applicant.attempt_id,
                    passed: true,
                  })
                }
              >
                Writing passed
              </button>
              <button
                disabled={!reviewer || needsReason}
                onClick={() =>
                  void action({
                    action: "mark_writing",
                    attemptId: applicant.attempt_id,
                    passed: false,
                  })
                }
              >
                Writing not passed — send to Manager
              </button>
            </div>
          )}
          {manager &&
            ["manager_review", "failed"].includes(applicant.phase ?? "") && (
              <div className={styles.actions}>
                {applicant.phase === "manager_review" && (
                  <button
                    disabled={needsReason}
                    onClick={() =>
                      void action({
                        action: "review",
                        attemptId: applicant.attempt_id,
                        decision: "confirm_fail",
                      })
                    }
                  >
                    Confirm not passed
                  </button>
                )}
                <button
                  disabled={needsReason || applicant.reopens_used !== 0}
                  onClick={() =>
                    void action({
                      action: "review",
                      attemptId: applicant.attempt_id,
                      decision: "reopen",
                    })
                  }
                >
                  Reopen once
                </button>
              </div>
            )}
        </section>
      ))}
      <details className={styles.card}>
        <summary>Approved onboarding wording</summary>
        <p>
          Version 1.0 – effective 1 October 2026, approved by Opulence Bliss.
          Email delivery is restricted to the approved staging test inbox.
        </p>
        <ul>
          {Object.values(CLEANER_ONBOARDING_MISSING_SOURCES).map((item) => (
            <li key={item.reference}>{item.wording}</li>
          ))}
        </ul>
      </details>
    </main>
  );
}
