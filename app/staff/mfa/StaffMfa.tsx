"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type Factor = { id: string; friendly_name?: string };
export default function StaffMfa() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void createClient()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(
            "Your authenticator could not be checked. Refresh or sign out and try again.",
          );
          return;
        }
        const available = data.totp.filter(
          (factor) => factor.status === "verified",
        );
        setFactors(available);
        setFactorId(available[0]?.id ?? "");
        setReady(true);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Your authenticator could not be checked. Refresh or sign out and try again.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const client = createClient();
      const current = await client.auth.mfa.listFactors();
      if (current.error) throw new Error();
      // Never remove an enrolled/verified factor. Only restart incomplete setup.
      for (const factor of current.data.all.filter(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "unverified",
      )) {
        const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw new Error();
      }
      const result = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Opulence Bliss staff",
        issuer: "Opulence Bliss",
      });
      if (result.error) throw new Error();
      setFactorId(result.data.id);
      setQr(result.data.totp.qr_code);
      setSecret(result.data.totp.secret);
      setCode("");
    } catch {
      setError(
        "Authenticator setup could not be started. Please retry or contact hello@opulencebliss.com.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const client = createClient();
      const result = await client.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      setCode("");
      if (result.error) {
        setError(
          "That code was invalid or expired. Enter the latest code from your app.",
        );
        return;
      }
      setQr("");
      setSecret("");
      window.location.assign("/admin");
    } catch {
      setError("Sign-in could not be verified. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.wrap}>
      <section className={styles.card}>
        <p className={styles.brand}>Opulence Bliss · Staff security</p>
        <h1>
          {factors.length ? "Two-step sign-in" : "Set up your authenticator"}
        </h1>
        <p>
          Staff access requires a code from an authenticator app, such as Google
          Authenticator, Microsoft Authenticator or 1Password. Email and SMS
          codes cannot unlock the admin area.
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {!ready ? (
          <p role="status">Checking your authenticator…</p>
        ) : (
          <>
            {!factors.length && !qr && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void enroll()}
              >
                {busy ? "Starting setup…" : "Set up authenticator"}
              </button>
            )}
            {qr && (
              <div className={styles.setup}>
                <p>
                  Scan this QR code in your authenticator app. Keep the setup
                  key private.
                </p>
                {/* Supabase returns an SVG data URI, not executable inline HTML. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  width={220}
                  height={220}
                  alt="Authenticator setup QR code"
                />
                <details>
                  <summary>
                    Can&apos;t scan? Enter the setup key manually
                  </summary>
                  <code>{secret}</code>
                </details>
              </div>
            )}
            {(factors.length > 0 || qr) && (
              <form onSubmit={verify}>
                {factors.length > 1 && (
                  <label>
                    Authenticator
                    <select
                      value={factorId}
                      onChange={(event) => setFactorId(event.target.value)}
                      disabled={busy}
                    >
                      {factors.map((factor, index) => (
                        <option key={factor.id} value={factor.id}>
                          {factor.friendly_name || `Authenticator ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label htmlFor="totp-code">Six-digit authenticator code</label>
                <input
                  id="totp-code"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  disabled={busy}
                />
                <button disabled={busy}>
                  {busy
                    ? "Verifying…"
                    : factors.length
                      ? "Verify and continue"
                      : "Enable and continue"}
                </button>
              </form>
            )}
          </>
        )}
        <p className={styles.help}>
          Lost access to your authenticator? Contact hello@opulencebliss.com.
          Support must verify your identity before recovery; there is no
          password-only bypass.
        </p>
        <button
          type="button"
          className={styles.signout}
          disabled={busy}
          onClick={async () => {
            await createClient().auth.signOut();
            window.location.assign("/staff/login");
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
