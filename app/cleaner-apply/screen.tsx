"use client";

import { useState, type FormEvent } from "react";
import { pendingOnboardingWording } from "@/lib/cleanerOnboardingPlaceholders";
import styles from "./screen.module.css";

export default function ApplicationForm() {
  const [state, setState] = useState<"editing" | "saving" | "saved">("editing");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving") return;
    const data = new FormData(event.currentTarget);
    setState("saving");
    setError("");
    try {
      const response = await fetch("/api/cleaner-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(data),
          areas: String(data.get("areas") ?? "")
            .split(",")
            .map((area) => area.trim())
            .filter(Boolean),
          checksAcknowledged: data.get("checksAcknowledged") === "on",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "Please try again.");
      setState("saved");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
      setState("editing");
    }
  }
  return (
    <main className={styles.page}>
      <p className={styles.notice}>
        Staging preview. Fictional test applications only.
      </p>
      <h1>Apply to work as a cleaner</h1>
      <p>This application creates a record. It does not create a login.</p>
      {state === "saved" ? (
        <div role="status" className={styles.notice}>
          <h2>Test application received</h2>
          <p>{pendingOnboardingWording("applicationReceived")}</p>
          <p>
            The confirmation email is held until the client approves the draft
            wording.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className={styles.form}>
          <label>
            Full name
            <input
              name="fullName"
              autoComplete="name"
              maxLength={150}
              required
            />
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
            />
          </label>
          <label>
            UK phone number
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              required
            />
          </label>
          <label>
            Home postcode
            <input
              name="postcode"
              autoComplete="postal-code"
              maxLength={10}
              required
            />
          </label>
          <label>
            Areas you cover, separated by commas
            <input name="areas" maxLength={1000} required />
          </label>
          <label>
            Cleaning experience
            <textarea name="experience" maxLength={2000} rows={4} required />
          </label>
          <label>
            General availability
            <textarea name="availability" maxLength={1000} rows={3} required />
          </label>
          <label>
            Type of right to work
            <input name="rightToWorkType" maxLength={150} required />
          </label>
          <label>
            Referral code (optional)
            <input name="referralCode" maxLength={80} />
          </label>
          <div className={styles.trap} aria-hidden="true">
            <label>
              Leave this empty
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <label className={styles.check}>
            <input name="checksAcknowledged" type="checkbox" required />
            <span>
              {pendingOnboardingWording("applicationNotice")}{" "}
              <a
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Privacy Notice
              </a>
            </span>
          </label>
          <p>
            This declaration is a draft awaiting client approval. Use fictional
            staging details only.
          </p>
          {error && <p role="alert">{error}</p>}
          <button
            type="submit"
            disabled={state === "saving"}
            aria-busy={state === "saving"}
          >
            {state === "saving" ? "Saving…" : "Submit test application"}
          </button>
        </form>
      )}
    </main>
  );
}
