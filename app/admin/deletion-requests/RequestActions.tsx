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
      <h3>{completed ? "Erase reviewed account" : "Decline request"}</h3>
      <p>{completed
        ? "This permanently removes sign-in, private profile details and uploaded documents. Closed transaction and agreement records are retained. Unfinished bookings or unsettled payments block erasure."
        : "Use this when the request cannot be fulfilled, and explain the reason."}</p>
      <label className={styles.noteLabel}>
        Outcome note
        <textarea name="note" minLength={10} maxLength={1000} required rows={3} placeholder={completed ? "Record what was completed and what must be retained." : "Explain why this request cannot be fulfilled."} />
      </label>
      <p className={styles.noteHint}>Use factual wording. This note is included in the account holder&apos;s data export.</p>
      {completed && (
        <label className={styles.confirmLabel}>
          <span>Type ERASE ACCOUNT to confirm</span>
          <input name="erasureConfirmed" required pattern="ERASE ACCOUNT" autoComplete="off" />
        </label>
      )}
      <button className={completed ? styles.primaryButton : styles.secondaryButton} disabled={pending} type="submit">
        {pending ? "Saving…" : completed ? "Erase account" : "Decline with reason"}
      </button>
      {state.message && <p className={state.ok ? styles.success : styles.error} role="status">{state.message}</p>}
    </form>
  );
}
