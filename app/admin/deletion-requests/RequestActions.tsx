"use client";

import { useActionState } from "react";
import { updateDeletionRequest, type ReviewState } from "./actions";
import styles from "./page.module.css";

const initialState: ReviewState = { ok: false, message: "" };

export default function RequestActions({ id, status }: { id: string; status: "pending" | "in_review" }) {
  const [state, action, pending] = useActionState(updateDeletionRequest, initialState);

  if (status === "pending") {
    return (
      <form action={action} className={styles.actionForm}>
        <input type="hidden" name="requestId" value={id} />
        <input type="hidden" name="nextStatus" value="in_review" />
        <p>Start review when you begin checking the account and its obligations.</p>
        <button className={styles.primaryButton} disabled={pending} type="submit">
          {pending ? "Saving…" : "Start review"}
        </button>
        {state.message && <p className={state.ok ? styles.success : styles.error} role="status">{state.message}</p>}
      </form>
    );
  }

  return (
    <div className={styles.decisionGrid}>
      <DecisionForm id={id} nextStatus="completed" />
      <DecisionForm id={id} nextStatus="declined" />
    </div>
  );
}

function DecisionForm({ id, nextStatus }: { id: string; nextStatus: "completed" | "declined" }) {
  const [state, action, pending] = useActionState(updateDeletionRequest, initialState);
  const completed = nextStatus === "completed";
  return (
    <form action={action} className={styles.actionForm}>
      <input type="hidden" name="requestId" value={id} />
      <input type="hidden" name="nextStatus" value={nextStatus} />
      <h3>{completed ? "Complete request" : "Decline request"}</h3>
      <p>{completed
        ? "Use this only after the separate account and data work is finished. This button records the outcome; it does not delete anything."
        : "Use this when the request cannot be fulfilled, and explain the reason."}</p>
      <label className={styles.noteLabel}>
        Outcome note
        <textarea name="note" minLength={10} maxLength={1000} required rows={3} placeholder={completed ? "Record what was completed and what must be retained." : "Explain why this request cannot be fulfilled."} />
      </label>
      <p className={styles.noteHint}>Use factual wording. This note is included in the account holder&apos;s data export.</p>
      {completed && (
        <label className={styles.confirmLabel}>
          <input type="checkbox" name="workConfirmed" value="yes" required />
          <span>I have completed the separate account and data work.</span>
        </label>
      )}
      <button className={completed ? styles.primaryButton : styles.secondaryButton} disabled={pending} type="submit">
        {pending ? "Saving…" : completed ? "Mark completed" : "Decline with reason"}
      </button>
      {state.message && <p className={state.ok ? styles.success : styles.error} role="status">{state.message}</p>}
    </form>
  );
}
