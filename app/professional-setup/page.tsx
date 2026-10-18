"use client";
import { FormEvent, useState } from "react";
export default function ProfessionalSetup() {
  const [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/professional-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign("/provider/join");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 520, padding: 24, margin: "60px auto" }}>
      <h1>Welcome to Opulence Bliss</h1>
      <p>
        Set your password, then complete your professional application. Your
        jobs remain locked until the team verifies your documents and approves
        your service.
      </p>
      <form onSubmit={submit}>
        <label>
          UK phone number
          <input
            required
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label style={{ display: "block", marginBlock: 20 }}>
          New password
          <input
            required
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p>
          At least 12 characters, including uppercase, lowercase and a number.
        </p>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>
          {busy ? "Saving…" : "Continue application"}
        </button>
      </form>
    </main>
  );
}
