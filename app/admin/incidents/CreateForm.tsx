"use client";
import { useActionState, useState } from "react";
import { createIncident } from "./actions";
import styles from "../deletion-requests/page.module.css";
export default function CreateForm() {
  const [kind, setKind] = useState("complaint");
  const [state, action, pending] = useActionState(createIncident, {
    ok: false,
    message: "",
  });
  return (
    <form action={action} className={styles.actionForm}>
      <h2>Record a complaint or breach</h2>
      <label className={styles.noteLabel}>
        Type
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          required
        >
          <option value="complaint">Complaint</option>
          <option value="breach">Breach</option>
          <option value="incident">Incident</option>
        </select>
      </label>
      <label className={styles.noteLabel}>
        Complainant email (for a complaint logged on their behalf)
        <input
          name="email"
          type="email"
          maxLength={254}
          required={kind === "complaint"}
        />
      </label>
      <label className={styles.noteLabel}>
        Who is looking into it?
        <input
          name="handler"
          maxLength={160}
          defaultValue="The Opulence Bliss support team"
          required
        />
      </label>
      <label className={styles.noteLabel}>
        Complaint response times
        <select name="complaintKind">
          <option value="standard">Standard — 14 days</option>
          <option value="complex">
            Complex — update by day 14; reply by day 28
          </option>
          <option value="data">Personal information — 30 days</option>
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
