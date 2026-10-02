"use client";
import { useActionState } from "react";
import { reviewIncident } from "./actions";
import styles from "@/components/IncidentReport.module.css";
export default function ReviewForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(reviewIncident, { message: "", ok: false });
  return <div className={styles.report}><form action={action}>
    <input type="hidden" name="id" value={id} />
    <label>Review status<select name="status"><option value="in_review">In review</option><option value="resolved">Resolved</option></select></label>
    <label>Outcome note<textarea name="note" maxLength={2000} rows={3} /></label>
    <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save review"}</button>
    {state.message && <p role="status">{state.message}</p>}
  </form></div>;
}
