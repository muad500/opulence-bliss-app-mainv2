"use client";
import { useEffect, useState, type FormEvent } from "react";
import styles from "../cleaner-apply/screen.module.css";
type Decision = {
  decision: string;
  reasons: string;
  publishedAt: string;
  reference: string;
  reviewRequested: boolean;
};
export default function SecureDecision() {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [message, setMessage] = useState("Opening your personal decision…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const access = new URLSearchParams(window.location.hash.slice(1)).get(
      "access",
    );
    if (access) window.history.replaceState(null, "", window.location.pathname);
    const controller = new AbortController();
    fetch("/api/cleaner-decision", {
      cache: "no-store",
      signal: controller.signal,
      ...(access
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "open", access }),
          }
        : {}),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        setDecision(data);
        setMessage("");
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setMessage(error.message || "Unable to open this decision.");
      });
    return () => controller.abort();
  }, []);
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const statement = String(
      new FormData(event.currentTarget).get("statement") ?? "",
    );
    try {
      const response = await fetch("/api/cleaner-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review", statement }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setDecision(data);
      setMessage("Your request for a Manager review has been recorded.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <h1>Your application decision</h1>
      <p>Private staging test record</p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {decision && (
        <>
          <p>Reference: {decision.reference}</p>
          <p>
            Decision date:{" "}
            {new Date(decision.publishedAt).toLocaleString("en-GB")}
          </p>
          <h2>Decision</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{decision.decision}</p>
          <h2>Reasons</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{decision.reasons}</p>
          {decision.reviewRequested ? (
            <p>A Manager review has been requested.</p>
          ) : (
            <form className={styles.form} onSubmit={review}>
              <label>
                Your explanation or request for a review
                <textarea
                  name="statement"
                  rows={5}
                  minLength={10}
                  maxLength={4000}
                  required
                />
              </label>
              <button disabled={busy}>Request a Manager review</button>
            </form>
          )}
          <p>
            For help accessing your record, contact{" "}
            <a href="mailto:hello@opulencebliss.com">hello@opulencebliss.com</a>
            . Do not send identity or DBS documents through personal email.
          </p>
        </>
      )}
    </main>
  );
}
