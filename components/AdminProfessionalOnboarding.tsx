"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ChevronDown, Mail, Plus, UserRound } from "lucide-react";
import AdminSkeleton from "@/app/admin/AdminSkeleton";
import styles from "./AdminProfessionalOnboarding.module.css";

type Invitation = {
  provider_id: string;
  sent_at: string | null;
  providers: { display_name: string } | null;
};

export default function AdminProfessionalOnboarding({
  handymanEnabled,
}: {
  handymanEnabled: boolean;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setListError("");
    try {
      const response = await fetch("/api/admin/professional-onboarding", {
        cache: "no-store",
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error("Invitations could not be loaded.");
      if (!signal?.aborted) setInvitations(result.invitations ?? []);
    } catch {
      if (!signal?.aborted)
        setListError("Invitations could not be loaded. Please try again.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function resend(providerId: string) {
    if (busy) return;
    setBusy(providerId);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/professional-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", providerId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Invitation could not be sent.");
      setMessage(result.message || "Setup link sent.");
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Invitation could not be sent.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!data.getAll("services").length) {
      setError("Choose at least one service.");
      return;
    }
    setBusy("create");
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/professional-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          services: data.getAll("services"),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Invitation could not be sent.");
      setMessage(result.message || "Account created and setup link sent.");
      form.reset();
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>
        <span className={styles.icon}>
          <Plus size={19} aria-hidden="true" />
        </span>
        <span className={styles.summaryText}>
          <strong>Add a professional</strong>
          <span>Create their account and email a private setup link.</span>
        </span>
        <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.content}>
        <form
          onSubmit={submit}
          className={styles.form}
          aria-label="Add a professional"
        >
          <p className={styles.intro}>
            Enter their contact details. They complete their profile and upload
            documents using the link.
          </p>
          <fieldset disabled={busy !== null} className={styles.fields}>
            <legend className={styles.srOnly}>
              Professional contact details
            </legend>
            <label className={styles.fullWidth}>
              Full legal name
              <input
                required
                name="name"
                maxLength={160}
                autoComplete="name"
                placeholder="e.g. Amina Khan"
              />
            </label>
            <label>
              Email address
              <input
                required
                type="email"
                name="email"
                autoComplete="email"
                placeholder="name@example.com"
              />
            </label>
            <label>
              UK phone number
              <input
                required
                type="tel"
                name="phone"
                autoComplete="tel"
                placeholder="e.g. 07700 900123"
              />
            </label>
            <fieldset className={styles.services}>
              <legend>Services</legend>
              <div className={styles.choices}>
                <label>
                  <input
                    name="services"
                    type="checkbox"
                    value="cleaning"
                    defaultChecked
                  />{" "}
                  Cleaning
                </label>
                {handymanEnabled && (
                  <label>
                    <input name="services" type="checkbox" value="handyman" />{" "}
                    Property maintenance
                  </label>
                )}
              </div>
            </fieldset>
          </fieldset>
          <p className={styles.note}>
            The account stays pending until you verify their documents and
            approve their services.
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {message && (
            <p role="status" className={styles.success}>
              {message}
            </p>
          )}
          <button
            className={styles.primary}
            disabled={busy !== null}
            type="submit"
          >
            <Mail size={16} aria-hidden="true" />
            {busy === "create" ? "Sending setup link…" : "Send setup link"}
          </button>
        </form>
        <section
          className={styles.invitations}
          aria-labelledby="pending-invitations-heading"
        >
          <h3 id="pending-invitations-heading">Pending setup invitations</h3>
          {loading ? (
            <AdminSkeleton compact label="Loading setup invitations" />
          ) : listError ? (
            <div className={styles.error} role="alert">
              <p>{listError}</p>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void refresh()}
              >
                Try again
              </button>
            </div>
          ) : !invitations.length ? (
            <p className={styles.empty}>No pending invitations.</p>
          ) : (
            <ul className={styles.list}>
              {invitations.map((invite) => (
                <li key={invite.provider_id}>
                  <span className={styles.personIcon}>
                    <UserRound size={18} aria-hidden="true" />
                  </span>
                  <div className={styles.person}>
                    <strong>
                      {invite.providers?.display_name ?? "Professional"}
                    </strong>
                    <span>
                      {invite.sent_at ? "Invitation sent" : "Delivery pending"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy !== null}
                    onClick={() => void resend(invite.provider_id)}
                  >
                    {busy === invite.provider_id ? "Sending…" : "Resend link"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}
