"use client";
import { useEffect, useState, type FormEvent } from "react";
import ProfessionalLegalConsent from "@/components/ProfessionalLegalConsent";
import styles from "../cleaner-apply/screen.module.css";
type SetupState = {
  status: string;
  setupComplete: boolean;
  payoutReady: boolean;
  payoutUnavailable?: boolean;
};
export default function CleanerSetup() {
  const [state, setState] = useState<SetupState | null>(null),
    [message, setMessage] = useState("Loading your setup…");
  const [busy, setBusy] = useState(false),
    [consents, setConsents] = useState<Record<string, boolean>>({});
  async function refresh() {
    const response = await fetch("/api/cleaner-setup", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    setState(data);
    setMessage("");
  }
  useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
  }, []);
  async function send(input: Record<string, unknown>) {
    const response = await fetch("/api/cleaner-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    return data;
  }
  async function payout() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await send({ action: "payout" });
      window.location.assign(data.url);
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  }
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await send({
        ...Object.fromEntries(new FormData(event.currentTarget)),
        action: "accept",
        consents,
      });
      await refresh();
      setMessage(
        "Your setup has been recorded. Independent final sign-off is still required before job offers.",
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <p className={styles.notice}>
        Staging only. Fictional test applicants and Stripe test setup.
      </p>
      <h1>Your cleaner account setup</h1>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {state &&
        (state.setupComplete ? (
          <section>
            <h2>Setup recorded</h2>
            <p>
              Application status: {state.status}. New work stays locked until
              the team completes independent sign-off.
            </p>
            <a href="/account/roles/cleaner">View your cleaner account</a>
          </section>
        ) : (
          <>
            <p>
              Your pre-induction checks and passed assessment are already on
              your record. You do not need to repeat them here.
            </p>
            <h2>Payout setup</h2>
            <p>
              Bank details are entered with Stripe, not stored on this site.
            </p>
            <p>
              {state.payoutReady
                ? "Your own Stripe test account is ready."
                : "Complete your own Stripe test account before finishing setup."}
            </p>
            <button type="button" disabled={busy} onClick={payout}>
              Open Stripe test setup
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                refresh()
                  .catch((error) => setMessage(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              Refresh payout status
            </button>
            <form className={styles.form} onSubmit={accept}>
              <h2>Emergency contact</h2>
              <p>
                This contact is private and used for safeguarding and
                lone-working support.
              </p>
              <label>
                Contact name
                <input name="emergencyName" maxLength={150} required />
              </label>
              <label>
                Relationship
                <input name="emergencyRelationship" maxLength={120} required />
              </label>
              <label>
                UK phone number
                <input
                  name="emergencyPhone"
                  type="tel"
                  maxLength={40}
                  required
                />
              </label>
              <label>
                Payout schedule
                <select name="schedule" defaultValue="weekly">
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <ProfessionalLegalConsent
                cleaning
                handyman={false}
                value={consents}
                onChange={setConsents}
              />
              <button disabled={busy || !state.payoutReady} aria-busy={busy}>
                Save acceptances and finish setup
              </button>
            </form>
          </>
        ))}
    </main>
  );
}
