"use client";
import { useState, type FormEvent } from "react";
import styles from "./IncidentReport.module.css";

export default function IncidentReport({ professional = false }: { professional?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setMessage(""); setError(false);
    try {
      const response = await fetch("/api/account/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not send your report.");
      setMessage(`Your private report has been received. Reference: ${result.reference}. The support team will review it.`);
      form.reset();
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : "Could not send your report."); }
    finally { setBusy(false); }
  }
  return <details className={styles.report}>
    <summary>{professional ? "Report an incident" : "Report a problem"}</summary>
    <form onSubmit={submit}>
      <p>Reports are private and reviewed by support. For immediate danger, call 999.</p>
      <label>What is it about?<select name="category" required><option value="booking">A booking or visit</option><option value="safety">Safety or an incident</option><option value="payment">Payments</option><option value="account">My account</option><option value="other">Something else</option></select></label>
      <label>Booking reference (optional)<input name="bookingId" maxLength={36} placeholder="Copy the reference from your booking" /></label>
      <label>Tell us what happened<textarea name="description" minLength={20} maxLength={5000} required rows={5} /></label>
      <p>Please do not include bank details, passwords or identity documents.</p>
      <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send private report"}</button>
      {message && <p className={error ? styles.error : styles.success} role="status">{message}</p>}
    </form>
  </details>;
}
