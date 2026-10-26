"use client";
import { useActionState } from "react";
import { createIncident } from "./actions";
import styles from "../deletion-requests/page.module.css";
export default function CreateForm() {
  const [state, action, pending] = useActionState(createIncident, {
    ok: false,
    message: "",
  });
  return (
    <form action={action} className={styles.actionForm}>
      <h2>Record a complaint or breach</h2>
      <label className={styles.noteLabel}>
        Type
        <select name="kind" required>
          <option value="complaint">Complaint</option>
          <option value="breach">Breach</option>
          <option value="incident">Incident</option>
        </select>
      </label>
      <label className={styles.noteLabel}>
        Category
        <select name="category">
          <option value="booking">Booking</option>
          <option value="safety">Safety</option>
          <option value="payment">Payment</option>
          <option value="account">Account</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className={styles.noteLabel}>
        Booking reference, if relevant
        <input name="booking" maxLength={36} />
      </label>
      <label className={styles.noteLabel}>
        Professional reference, if relevant
        <input name="provider" maxLength={36} />
      </label>
      <label className={styles.noteLabel}>
        What happened?
        <textarea
          name="description"
          required
          minLength={20}
          maxLength={5000}
          rows={4}
        />
      </label>
      <p>
        Staff only. An open report protects linked records from scheduled
        deletion. Record facts and the action needed.
      </p>
      <button className={styles.primaryButton} disabled={pending}>
        {pending ? "Saving…" : "Save private report"}
      </button>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
